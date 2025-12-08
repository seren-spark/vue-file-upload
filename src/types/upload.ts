import type { ApiResponse } from './request'

// 上传状态枚举
export enum UploadStatus {
  PENDING = 'pending', // 等待中
  HASHING = 'hashing', // 计算MD5中
  CHECKING = 'checking', // 检查秒传
  UPLOADING = 'uploading', // 上传中
  MERGING = 'merging', // 合并中
  SUCCESS = 'success', // 成功
  ERROR = 'error', // 失败
  PAUSED = 'paused', // 暂停
  CANCELLED = 'cancelled', // 已取消
}

// 分片状态
export enum ChunkStatus {
  PENDING = 'pending',
  UPLOADING = 'uploading',
  SUCCESS = 'success',
  ERROR = 'error',
}

// 分片信息
export interface ChunkInfo {
  index: number // 分片索引
  start: number // 起始字节
  end: number // 结束字节
  size: number // 分片大小
  status: ChunkStatus // 状态
  uploadUrl?: string // 上传地址（预签名URL）
  retryCount: number // 重试次数
  progress: number // 上传进度 0-100
}

// 上传文件信息
export interface UploadFileInfo {
  id: string // 唯一ID
  file: File // 原始文件
  name: string // 文件名
  size: number // 文件大小
  type: string // MIME类型
  md5?: string // 文件MD5
  status: UploadStatus // 上传状态
  progress: number // 总进度 0-100
  hashProgress: number // MD5计算进度 0-100
  chunks: ChunkInfo[] // 分片列表
  uploadedChunks: number[] // 已上传的分片索引
  error?: string // 错误信息
  startTime?: number // 开始时间
  speed?: number // 上传速度 bytes/s
  remainingTime?: number // 剩余时间 秒
  abortController?: AbortController // 取消控制器
  uploadId?: string
}

// Worker消息类型
export interface WorkerMessage {
  type: 'start' | 'progress' | 'complete' | 'error'
  fileId: string
  data?: {
    progress?: number
    md5?: string
    error?: string
  }
}

// 初始化上传请求
export interface InitUploadRequest {
  originalName: string
  md5: string
  chunkSize: number
  chunkNum: number
  contentType: string
}

// // 初始化上传响应
// export interface InitUploadResponse {
//   uploadId: string
//   uploadUrls: string[] // 每个分片的预签名上传URL
//   uploadedChunks: number[] // 已上传的分片索引（断点续传）
// }

// 初始化上传响应数据
export interface InitUploadData {
  uploadId: string
  urlList: string[] // 注意：是 urlList 不是 uploadUrls
}

// 完整响应类型
export type InitUploadResponse = ApiResponse<InitUploadData>

// 检查文件响应
export interface CheckFileResponse {
  exists: boolean // 文件是否已存在
  url?: string // 如果存在，返回文件URL
}

// 合并请求响应
export interface MergeResponse<T> {
  code: number
  message: string
  // url?: string // 合并后的文件URL
  // error?: string
  data: T
}

// 上传配置
export interface UploadConfig {
  chunkSize: number // 分片大小，默认5MB
  maxConcurrent: number // 最大并发数，默认3
  maxRetries: number // 最大重试次数，默认3
  retryDelay: number // 重试延迟，默认1000ms
  timeout: number // 请求超时，默认30000ms
  workerCount: number // Worker数量，默认navigator.hardwareConcurrency || 4
}

// 上传事件
export interface UploadEvents {
  onProgress?: (file: UploadFileInfo) => void
  onHashProgress?: (file: UploadFileInfo) => void
  onStatusChange?: (file: UploadFileInfo) => void
  onSuccess?: (file: UploadFileInfo, url: string) => void
  onError?: (file: UploadFileInfo, error: Error) => void
}
