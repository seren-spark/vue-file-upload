import SparkMD5 from 'spark-md5'

const CHUNK_SIZE = 1024 * 1024 * 2 //2mb

//主线程给worker传递的参数类型
interface WokerInput {
  type: 'calculate' // 计算指令
  fileId: string //文件唯一标识(用于主线程区分多个文件)
  file: File
}

interface WorkerOutput {
  type: 'progress' | 'complete' | 'error'
  fileId: string
  data: {
    progress?: number
    md5?: string
    error?: string
  }
}

self.onmessage = async (e: MessageEvent<WokerInput>) => {
  const { type, fileId, file } = e.data

  if (type !== 'calculate') return

  try {
    const spark = new SparkMD5.ArrayBuffer() //创建md5 实例
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE) //总分片数
    let currentChunk = 0 //当前处理到第几个

    const readChunk = (start: number, end: number): Promise<ArrayBuffer> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = (e) => resolve(e.target?.result as ArrayBuffer)
        reader.onerror = () => reject(new Error('读取文件失败'))
        reader.readAsArrayBuffer(file.slice(start, end)) //
      })
    }

    while (currentChunk < totalChunks) {
      const start = currentChunk * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, file.size)
      const buffer = await readChunk(start, end)
      spark.append(buffer)

      currentChunk++

      // 报告进度
      const progress = Math.round((currentChunk / totalChunks) * 100)
      self.postMessage({
        type: 'progress',
        fileId,
        data: { progress },
      } as WorkerOutput)
    }
    const md5 = spark.end()
    self.postMessage({
      type: 'complete',
      fileId,
      data: { md5 },
    } as WorkerOutput)
  } catch (error) {
    self.postMessage({
      type: 'error',
      fileId,
      data: { error: (error as Error).message },
    } as WorkerOutput)
  }
}
