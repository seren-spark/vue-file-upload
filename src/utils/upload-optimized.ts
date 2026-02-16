// 上传的核心方法（优化版）
import axios from 'axios'
import {
  type UploadFileInfo,
  type ChunkInfo,
  type UploadConfig,
  type UploadEvents,
  type InitUploadRequest,
  type InitUploadResponse,
  type MergeResponse,
  ChunkStatus,
  UploadStatus,
  type InitUploadData,
} from '@/types/upload'
import { v4 as uuidv4 } from 'uuid'
import { WorkerPool } from './workerPool'

const DEFAULT_CONFIG: UploadConfig = {
  chunkSize: 5 * 1024 * 1024, // 5MB
  maxConcurrent: 3,
  maxRetries: 3,
  retryDelay: 1000,
  timeout: 30000,
  workerCount: navigator.hardwareConcurrency || 4,
}
const API_BASE = 'http://47.121.196.50:8000/minio'

export class UploadService {
  private config: UploadConfig
  private events: UploadEvents
  private workerPool: WorkerPool

  constructor(config?: Partial<UploadConfig>, events?: UploadEvents) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.events = events || {}
    this.workerPool = new WorkerPool('./md5.worker.ts', this.config.workerCount)
  }

  private generateId(): string {
    return uuidv4()
  }

  private createChunks(file: File): ChunkInfo[] {
    const chunks: ChunkInfo[] = []
    const chunksCount = Math.ceil(file.size / this.config.chunkSize)
    for (let i = 0; i < chunksCount; i++) {
      const start = i * this.config.chunkSize
      const end = Math.min(start + this.config.chunkSize, file.size)
      chunks.push({
        index: i,
        start,
        end,
        size: end - start,
        status: ChunkStatus.PENDING,
        retryCount: 0,
        progress: 0,
      })
    }
    return chunks
  }

  async addFile(file: File) {
    const fileInfo: UploadFileInfo = {
      id: this.generateId(),
      file,
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      status: UploadStatus.PENDING,
      progress: 0,
      hashProgress: 0,
      chunks: this.createChunks(file),
      uploadedChunks: [],
      startTime: Date.now(),
    }
    return fileInfo
  }

  private async calculateMD5(fileInfo: UploadFileInfo): Promise<string> {
    fileInfo.status = UploadStatus.HASHING
    this.events.onStatusChange?.(fileInfo)

    const result = await this.workerPool.execute<{ md5: string }>(
      fileInfo.id,
      fileInfo.file,
      (progress) => {
        fileInfo.hashProgress = progress
        this.events.onHashProgress?.(fileInfo)
      },
    )
    fileInfo.md5 = result.md5
    return result.md5
  }

  private async checkFileExists(md5: string) {
    const response = await axios.get(`${API_BASE}/check/${md5}`)
    return response.data
  }

  private async initUpload(fileInfo: UploadFileInfo): Promise<InitUploadData> {
    const request: InitUploadRequest = {
      originalName: fileInfo.name,
      md5: fileInfo.md5!,
      chunkSize: this.config.chunkSize,
      chunkNum: fileInfo.chunks.length,
      contentType: fileInfo.type,
    }

    const response = await axios.post<InitUploadResponse>(`${API_BASE}/init`, request)
    if (response.data.code == 703) {
      throw new Error('初始化异常')
    }
    return response.data.data
  }

  private async uploadChunk(fileInfo: UploadFileInfo, chunk: ChunkInfo): Promise<void> {
    const blob = fileInfo.file.slice(chunk.start, chunk.end)
    chunk.status = ChunkStatus.UPLOADING

    try {
      await axios.put(chunk.uploadUrl!, blob, {
        headers: { 'Content-Type': 'application/octet-stream' },
        timeout: this.config.timeout,
        signal: fileInfo.abortController?.signal,
        onUploadProgress: (event) => {
          if (event.total) {
            chunk.progress = Math.round((event.loaded / event.total) * 100)
            this.updateTotalProgress(fileInfo)
          }
        },
      })

      chunk.status = ChunkStatus.SUCCESS
      chunk.progress = 100
    } catch (error) {
      if (axios.isCancel(error)) {
        chunk.status = ChunkStatus.PENDING
        throw error
      }

      chunk.retryCount++

      if (chunk.retryCount < this.config.maxRetries) {
        await this.delay(this.config.retryDelay * chunk.retryCount)
        return this.uploadChunk(fileInfo, chunk)
      }

      chunk.status = ChunkStatus.ERROR
      throw error
    }
  }

  // ✅ 优化：并发上传分片（失败不影响其他分片）
  private async uploadChunks(fileInfo: UploadFileInfo): Promise<void> {
    fileInfo.status = UploadStatus.UPLOADING
    fileInfo.abortController = new AbortController()
    this.events.onStatusChange?.(fileInfo)

    const pendingChunks = fileInfo.chunks.filter(
      (chunk) => !fileInfo.uploadedChunks.includes(chunk.index),
    )

    const executing: Promise<void>[] = []

    for (const chunk of pendingChunks) {
      const promise = this.uploadChunk(fileInfo, chunk)
        .then(() => {
          executing.splice(executing.indexOf(promise), 1)
        })
        .catch((err) => {
          // ✅ 优化：捕获错误，不抛出（避免影响其他分片）
          executing.splice(executing.indexOf(promise), 1)
          console.error(`分片 ${chunk.index} 上传失败:`, err.message)
        })

      executing.push(promise)

      if (executing.length >= this.config.maxConcurrent) {
        await Promise.race(executing)
      }
    }

    // ✅ 优化：使用 Promise.allSettled 等待所有分片（包括失败的）
    await Promise.allSettled(executing)

    // ✅ 优化：检查失败的分片
    const failedChunks = fileInfo.chunks.filter((c) => c.status === ChunkStatus.ERROR)
    if (failedChunks.length > 0) {
      console.warn(`有 ${failedChunks.length} 个分片上传失败，将在后续重试`)
    }
  }

  // ✅ 新增：失败分片多轮重试
  private async uploadChunksWithRetry(fileInfo: UploadFileInfo): Promise<void> {
    // 第一轮：上传所有分片
    await this.uploadChunks(fileInfo)

    // 第二轮：重试失败的分片（最多 3 轮）
    let failedChunks = fileInfo.chunks.filter((c) => c.status === ChunkStatus.ERROR)
    let retryRound = 0
    const maxRetryRounds = 3

    while (failedChunks.length > 0 && retryRound < maxRetryRounds) {
      retryRound++
      console.log(`第 ${retryRound} 轮重试，失败分片数: ${failedChunks.length}`)

      // 重置失败分片的状态
      failedChunks.forEach((chunk) => {
        chunk.status = ChunkStatus.PENDING
        chunk.retryCount = 0
      })

      await this.uploadChunks(fileInfo)
      failedChunks = fileInfo.chunks.filter((c) => c.status === ChunkStatus.ERROR)
    }

    // 如果最终还有失败的分片，抛出错误
    if (failedChunks.length > 0) {
      throw new Error(
        `${failedChunks.length} 个分片最终上传失败（分片索引: ${failedChunks.map((c) => c.index).join(', ')}）`,
      )
    }
  }

  private async mergeChunks(fileInfo: UploadFileInfo): Promise<MergeResponse<{ url: string }>> {
    fileInfo.status = UploadStatus.MERGING
    this.events.onStatusChange?.(fileInfo)

    const response = await axios.post<MergeResponse<{ url: string }>>(
      `${API_BASE}/merge/${fileInfo.md5}`,
    )
    return response.data
  }

  private updateTotalProgress(fileInfo: UploadFileInfo) {
    const totalProgress = fileInfo.chunks.reduce((acc, chunk) => {
      return acc + chunk.progress * chunk.size
    }, 0)

    fileInfo.progress = Math.round(totalProgress / fileInfo.size)

    const elapsed = (Date.now() - (fileInfo.startTime || Date.now())) / 1000
    if (elapsed > 0) {
      const uploaded = fileInfo.size * (fileInfo.progress / 100)
      fileInfo.speed = uploaded / elapsed
      fileInfo.remainingTime = fileInfo.speed > 0 ? (fileInfo.size - uploaded) / fileInfo.speed : 0
    }

    this.events.onProgress?.(fileInfo)
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  // ✅ 修改：使用带重试的上传方法
  async startUpload(fileInfo: UploadFileInfo): Promise<void> {
    try {
      await this.calculateMD5(fileInfo)

      fileInfo.status = UploadStatus.CHECKING
      this.events.onStatusChange?.(fileInfo)

      const checkResult = await this.checkFileExists(fileInfo.md5!)

      if (checkResult.code == 700) {
        fileInfo.status = UploadStatus.SUCCESS
        fileInfo.progress = 100
        this.events.onStatusChange?.(fileInfo)
        this.events.onSuccess?.(fileInfo, checkResult.data.url!)
        return
      }

      const initResult = await this.initUpload(fileInfo)
      fileInfo.uploadId = initResult.uploadId

      const totalChunks = fileInfo.chunks.length
      const remainingChunks = initResult.urlList.length
      const uploadedCount = totalChunks - remainingChunks

      for (let i = 0; i < uploadedCount; i++) {
        const chunk = fileInfo.chunks[i]
        if (chunk) {
          chunk.status = ChunkStatus.SUCCESS
          chunk.progress = 100
          if (!fileInfo.uploadedChunks.includes(i)) {
            fileInfo.uploadedChunks.push(i)
          }
        }
      }

      for (let i = 0; i < remainingChunks; i++) {
        const chunkIndex = uploadedCount + i
        if (fileInfo.chunks[chunkIndex]) {
          fileInfo.chunks[chunkIndex].uploadUrl = initResult.urlList[i]
        }
      }

      // ✅ 使用带重试的上传方法
      await this.uploadChunksWithRetry(fileInfo)

      const mergeResult = await this.mergeChunks(fileInfo)

      if (mergeResult.code == 700) {
        fileInfo.status = UploadStatus.SUCCESS
        fileInfo.progress = 100
        this.events.onStatusChange?.(fileInfo)
        this.events.onSuccess?.(fileInfo, mergeResult.data.url!)
      } else {
        throw new Error(mergeResult.message || '合并失败')
      }
    } catch (error) {
      if (fileInfo.status !== UploadStatus.PAUSED && fileInfo.status !== UploadStatus.CANCELLED) {
        fileInfo.status = UploadStatus.ERROR
        fileInfo.error = (error as Error).message
        this.events.onError?.(fileInfo, error as Error)
      }
    }
  }

  pauseUpload(fileInfo: UploadFileInfo) {
    if (fileInfo.status === UploadStatus.UPLOADING) {
      fileInfo.abortController?.abort()
      fileInfo.status = UploadStatus.PAUSED
      this.events.onStatusChange?.(fileInfo)
    }
  }

  // ✅ 修改：使用带重试的上传方法
  async resumeUpload(fileInfo: UploadFileInfo) {
    if (fileInfo.status === UploadStatus.PAUSED || fileInfo.status === UploadStatus.ERROR) {
      fileInfo.chunks.forEach((chunk) => {
        if (chunk.status === ChunkStatus.ERROR) {
          chunk.status = ChunkStatus.PENDING
          chunk.retryCount = 0
        }
      })
    }

    try {
      // ✅ 使用带重试的上传方法
      await this.uploadChunksWithRetry(fileInfo)

      const mergeResult = await this.mergeChunks(fileInfo)
      if (mergeResult.code == 700) {
        fileInfo.status = UploadStatus.SUCCESS
        fileInfo.progress = 100
        this.events.onStatusChange?.(fileInfo)
        this.events.onSuccess?.(fileInfo, mergeResult.data?.url || '')
      } else {
        throw new Error(mergeResult.message || '合并失败')
      }
    } catch (error) {
      if (fileInfo.status !== UploadStatus.PAUSED && fileInfo.status !== UploadStatus.CANCELLED) {
        fileInfo.status = UploadStatus.ERROR
        fileInfo.error = (error as Error).message
        this.events.onError?.(fileInfo, error as Error)
      }
    }
  }

  cancelUpload(fileInfo: UploadFileInfo) {
    fileInfo.abortController?.abort()
    fileInfo.status = UploadStatus.CANCELLED
    this.events.onStatusChange?.(fileInfo)
  }

  destroy() {
    this.workerPool.terminate()
  }
}
