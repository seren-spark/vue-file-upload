// 上传的核心方法
import axios from 'axios'
import {
  type UploadFileInfo,
  type ChunkInfo,
  type UploadConfig,
  type UploadEvents,
  type InitUploadRequest,
  type InitUploadResponse,
  type CheckFileResponse,
  type MergeResponse,
  ChunkStatus,
  UploadStatus,
  type InitUploadData,
} from '@/types/upload'
import { v4 as uuidv4 } from 'uuid'
import { WorkerPool } from './workerPool'
import MD5Worker from './md5.worker.ts?worker'
const DEFAULT_CONFIG: UploadConfig = {
  chunkSize: 5 * 1024 * 1024, // 5MB
  maxConcurrent: 3,
  maxRetries: 3,
  retryDelay: 1000,
  timeout: 30000,
  workerCount: navigator.hardwareConcurrency || 4,
}
const API_BASE = 'http://1.14.158.107:8080/minio'

export class UploadService {
  private config: UploadConfig
  private events: UploadEvents
  private workerPool: WorkerPool
  private uploadQueue: Map<string, UploadFileInfo> = new Map()
  private activeUploads = 0
  constructor(config?: Partial<UploadConfig>, events?: UploadEvents) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.events = events || {}
    // this.workerPool = new WorkerPool(MD5Worker, this.config.workerCount)
    this.workerPool = new WorkerPool('./md5.worker.ts', this.config.workerCount)
  }
  private generateId(): string {
    return uuidv4() // 生成标准 UUID v4，如：1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed
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

  //添加文件到上传队列
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
    this.uploadQueue.set(fileInfo.id, fileInfo)
    return fileInfo
  }
  // 计算文件MD5
  private async calculateMD5(fileInfo: UploadFileInfo): Promise<string> {
    // 步骤1:更新文件状态为“正在计算MD5”，并通知上层（如组件更新UI）
    fileInfo.status = UploadStatus.HASHING
    this.events.onStatusChange?.(fileInfo)
    //触发md5计算
    const result = await this.workerPool.execute<{ md5: string }>(
      fileInfo.id, //任务唯一标识
      fileInfo.file, //要计算md5的文件对象
      (progress) => {
        //进度回调 (接收woker的计算进度)
        //进度回调
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

  // 初始化上传
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
  // 上传单个分片
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
      // if (!fileInfo.uploadedChunks.includes(chunk.index)) {
      //   fileInfo.uploadedChunks.push(chunk.index)
      // }
      // 保存断点信息
      this.saveProgress(fileInfo)
    } catch (error) {
      if (axios.isCancel(error)) {
        chunk.status = ChunkStatus.PENDING
        throw error
      }

      chunk.retryCount++

      if (chunk.retryCount < this.config.maxRetries) {
        // 指数退避重试
        await this.delay(this.config.retryDelay * chunk.retryCount)
        return this.uploadChunk(fileInfo, chunk)
      }

      chunk.status = ChunkStatus.ERROR
      throw error
    }
  }

  // 并发上传分片
  private async uploadChunks(fileInfo: UploadFileInfo): Promise<void> {
    // 标记文件状态为"正在上传"
    fileInfo.status = UploadStatus.UPLOADING
    // 创建中断控制器 用于后续暂停/取消上传时,中断正在进行的分片请求
    fileInfo.abortController = new AbortController()

    this.events.onStatusChange?.(fileInfo)
    // 筛选出"待上传的分片"(排除已上传/成功的分片,支持断点续传)
    const pendingChunks = fileInfo.chunks.filter(
      (chunk) => !fileInfo.uploadedChunks.includes(chunk.index),
    )

    // 使用并发控制
    // const uploadWithConcurrency = async () => {
    //  缺点（可优化点）
    // executing.splice 潜在问题：
    // executing.indexOf(promise) 依赖引用相等，若uploadChunk返回新 Promise（比如重试后），可能找不到，导致executing列表无法清理；
    // 优化方案：用Map<Promise, number>记录分片索引，或用队列（Queue）管理待上传分片。
    // 无优先级：所有分片按顺序上传，无法优先上传小分片 / 关键分片；
    // 失败后整体终止：单个分片重试失败会导致整个上传终止，可优化为 “标记失败分片，继续上传其他分片，最后统一重试失败分片”。

    // 存储“正在执行的上传Promise”（用于控制并发数）
    const executing: Promise<void>[] = []

    for (const chunk of pendingChunks) {
      // 1. 发起当前分片的上传请求（调用uploadChunk方法）
      const promise = this.uploadChunk(fileInfo, chunk).then(() => {
        // 上传完成后，从“正在执行”列表中移除该Promise
        executing.splice(executing.indexOf(promise), 1)
      })
      // 2. 将当前分片的上传Promise加入“正在执行”列表
      executing.push(promise)
      // 3. 关键：如果并发数达到上限（比如3），等待“任意一个分片上传完成”
      if (executing.length >= this.config.maxConcurrent) {
        await Promise.race(executing)
      }
    }

    // 4. 等待所有剩余的分片上传完成（最后一批不足maxConcurrent的分片）
    await Promise.all(executing)
    // }

    // await uploadWithConcurrency()
  }
  // 合并分片
  private async mergeChunks(fileInfo: UploadFileInfo): Promise<MergeResponse<any>> {
    fileInfo.status = UploadStatus.MERGING
    this.events.onStatusChange?.(fileInfo)
    console.log('合并中')

    const response = await axios.post<MergeResponse<any>>(`${API_BASE}/merge/${fileInfo.md5}`)
    return response.data
  }
  // 更新总进度
  private updateTotalProgress(fileInfo: UploadFileInfo) {
    const totalProgress = fileInfo.chunks.reduce((acc, chunk) => {
      return acc + chunk.progress * chunk.size
    }, 0)

    fileInfo.progress = Math.round(totalProgress / fileInfo.size)

    // 计算速度和剩余时间
    const elapsed = (Date.now() - (fileInfo.startTime || Date.now())) / 1000
    if (elapsed > 0) {
      const uploaded = fileInfo.size * (fileInfo.progress / 100)
      fileInfo.speed = uploaded / elapsed
      fileInfo.remainingTime = fileInfo.speed > 0 ? (fileInfo.size - uploaded) / fileInfo.speed : 0
    }

    this.events.onProgress?.(fileInfo)
  }

  // 延迟函数
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  // 保存进度到 localStorage
  private saveProgress(fileInfo: UploadFileInfo) {
    const key = `upload_progress_${fileInfo.md5}`
    const data = {
      uploadedChunks: fileInfo.uploadedChunks,
      uploadId: fileInfo.uploadId,
    }
    localStorage.setItem(key, JSON.stringify(data))
  }

  // 恢复进度
  private loadProgress(fileInfo: UploadFileInfo): boolean {
    const key = `upload_progress_${fileInfo.md5}`
    const data = localStorage.getItem(key)

    if (data) {
      try {
        const parsed = JSON.parse(data)
        fileInfo.uploadedChunks = parsed.uploadedChunks || []

        // 恢复已上传分片的状态
        fileInfo.uploadedChunks.forEach((index) => {
          const chunk = fileInfo.chunks[index]
          if (chunk) {
            chunk.status = ChunkStatus.SUCCESS
            chunk.progress = 100
          }
        })

        // 恢复上传URL
        parsed.chunks?.forEach((c: { index: number; uploadUrl?: string }) => {
          const chunk = fileInfo.chunks[c.index]
          if (chunk) {
            chunk.uploadUrl = c.uploadUrl
          }
        })

        return true
      } catch {
        localStorage.removeItem(key)
      }
    }
    return false
  }

  // 清除进度
  private clearProgress(fileInfo: UploadFileInfo) {
    const key = `upload_progress_${fileInfo.md5}`
    localStorage.removeItem(key)
  }

  // 开始上传
  async startUpload(fileInfo: UploadFileInfo): Promise<void> {
    try {
      // 1. 计算MD5
      await this.calculateMD5(fileInfo)

      // 2. 检查秒传
      fileInfo.status = UploadStatus.CHECKING
      this.events.onStatusChange?.(fileInfo)
      console.log('开始调用检测接口')

      const checkResult = await this.checkFileExists(fileInfo.md5!)
      console.log('checkResult', checkResult)

      if (checkResult.code == 700) {
        // 秒传成功
        fileInfo.status = UploadStatus.SUCCESS
        fileInfo.progress = 100
        this.clearProgress(fileInfo)
        this.events.onStatusChange?.(fileInfo)
        this.events.onSuccess?.(fileInfo, checkResult.data.url!)
        return
      }

      const initResult = await this.initUpload(fileInfo)
      console.log('初始化上传结果', initResult)

      // ✅ 保存 uploadId

      fileInfo.uploadId = initResult.uploadId
      // 4. 根据 urlList 长度判断已上传的分片
      const totalChunks = fileInfo.chunks.length
      const remainingChunks = initResult.urlList.length
      const uploadedCount = totalChunks - remainingChunks
      console.log('分片统计:', {
        总分片数: totalChunks,
        剩余分片数: remainingChunks,
        已上传分片数: uploadedCount,
      })

      // 5. 标记前面已上传的分片
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
      // 6. 为剩余分片设置上传URL
      // 从 uploadedCount 开始的分片需要上传
      for (let i = 0; i < remainingChunks; i++) {
        const chunkIndex = uploadedCount + i
        if (fileInfo.chunks[chunkIndex]) {
          fileInfo.chunks[chunkIndex].uploadUrl = initResult.urlList[i]
        }
      }

      console.log('分片URL设置完成:', {
        已上传分片: fileInfo.uploadedChunks,
        待上传分片: fileInfo.chunks
          .map((c, i) => ({ index: i, hasUrl: !!c.uploadUrl }))
          .filter((c) => c.hasUrl),
      })

      // 5. 上传分片
      await this.uploadChunks(fileInfo)

      // 6. 合并分片
      const mergeResult = await this.mergeChunks(fileInfo)

      if (mergeResult.code == 700) {
        fileInfo.status = UploadStatus.SUCCESS
        fileInfo.progress = 100
        this.clearProgress(fileInfo)
        console.log('合并分片蔡成功', mergeResult)
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

  // 暂停上传
  pauseUpload(fileInfo: UploadFileInfo) {
    if (fileInfo.status === UploadStatus.UPLOADING) {
      fileInfo.abortController?.abort()
      fileInfo.status = UploadStatus.PAUSED
      this.events.onStatusChange?.(fileInfo)
    }
  }

  // 恢复上传
  // 恢复上传
  async resumeUpload(fileInfo: UploadFileInfo) {
    if (fileInfo.status === UploadStatus.PAUSED || fileInfo.status === UploadStatus.ERROR) {
      // 重置失败的分片
      fileInfo.chunks.forEach((chunk) => {
        if (chunk.status === ChunkStatus.ERROR) {
          chunk.status = ChunkStatus.PENDING
          chunk.retryCount = 0
        }
      })
      //调用 startUpload会重新计算 MD5，对于暂停恢复的场景不太合适。应该直接从 uploadChunks继续
      // await this.startUpload(fileInfo)
      //  fileInfo.startTime = Date.now()
    }
    try {
      // 直接继续上传分片，不重新计算 MD5
      await this.uploadChunks(fileInfo)

      // 合并
      const mergeResult = await this.mergeChunks(fileInfo)
      if (mergeResult.code == 700) {
        fileInfo.status = UploadStatus.SUCCESS
        fileInfo.progress = 100
        this.clearProgress(fileInfo)
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

  // 取消上传
  cancelUpload(fileInfo: UploadFileInfo) {
    fileInfo.abortController?.abort()
    fileInfo.status = UploadStatus.CANCELLED
    this.clearProgress(fileInfo)
    this.uploadQueue.delete(fileInfo.id)
    this.events.onStatusChange?.(fileInfo)
  }

  // 销毁服务
  destroy() {
    this.workerPool.terminate()
    this.uploadQueue.clear()
  }
}
