// 线程池  管理多个web worker 实例  实现任务排队和并发控制
/**
 * 为什么需要WorkerPool
 * 如果直接为每个文件创建一个 Worker 实例（比如同时上传 10 个文件就创建 10 个 Worker），会导致：
 * 浏览器线程过多，占用大量内存和 CPU,反而降低性能
 * 无任务队列，所有任务同时发起，容易引发资源竞争
 * Worker 无法复用，每次计算完就销毁，重复创建 / 销毁有性能开销
 *
 * WorkerPool 解决了这样的问题
 * 固定线程数: 初始化时创建指定数量的 Worker 实例
 * 任务排队：超出并发数的任务进入队列，有 Worker 空闲时自动执行；
 * 统一管理：集中处理 Worker 的消息、错误、进度回调，简化主线程逻辑；
 * 进度透传：将 Worker 的进度回调透传给主线程，支持实时更新。
 *
 *
 * 核心逻辑
 * 1.初始化worker 放入线程池 workers
 * 2.比如提交计算任务
 * 3.processQueue 执行：
 *  - 前 4 个任务分配给 4 个 Worker → activeWorkers 映射 4 个 Worker
 *  - 剩余 2 个任务留在队列中
 * 4. 某个 Worker 完成任务 → releaseWorker 释放 → activeWorkers 减 1
 * 5. 再次执行 processQueue,从队列取第 5 个任务，分配给空闲 Worker
 * 6.重复步骤 4-5，直到所有任务执行完毕
 */
interface Task<T> {
  id: string //任务标识
  data: T //任务数据
  resolve: (value: unknown) => void //任务完成时的回调
  reject: (reason: unknown) => void //任务失败时的回调
  onProgress?: (progress: number) => void //任务进度回调
}
export class WorkerPool {
  private workers: Worker[] = [] // 所有 Worker 实例（线程池）
  private taskQueue: Task<unknown>[] = [] //等待执行的任务队列
  private activeWorkers = new Map<Worker, Task<unknown>>() //正在执行任务的Woker ->任务映射
  private workerUrl: string //woker 脚本的路径

  constructor(workerUrl: string, poolSize: number = navigator.hardwareConcurrency || 4) {
    this.workerUrl = workerUrl
    this.initWorkers(poolSize)
  }
  // 初始化worker
  private initWorkers(size: number) {
    for (let i = 0; i < size; i++) {
      //创建woker 实例
      const worker = new Worker(this.workerUrl, { type: 'module' })
      //监听woker发来的消息
      worker.onmessage = (e) => {
        const task = this.activeWorkers.get(worker) // 获取当前 Worker 绑定的任务
        if (!task) return

        const { type, data } = e.data

        switch (type) {
          case 'progress':
            task.onProgress?.(data.progress) // 透传进度回调
            break
          case 'complete':
            task.resolve(data)
            this.releaseWorker(worker) // 释放 Worker
            break
          case 'error':
            task.reject(new Error(data.error))
            this.releaseWorker(worker)
            break
        }
      }

      worker.onerror = (error) => {
        const task = this.activeWorkers.get(worker)
        if (task) {
          task.reject(error)
          this.releaseWorker(worker)
        }
      }

      this.workers.push(worker) //将创建的woker 放在线程池
    }
  }
  // 释放 Worker：标记为空闲，处理下一个任务
  private releaseWorker(worker: Worker) {
    this.activeWorkers.delete(worker) // 从“活跃 Worker”中移除
    this.processQueue() // 检查队列，执行下一个任务
  }

  private processQueue() {
    //如果没有任务
    if (this.taskQueue.length === 0) return

    //空闲worker 实际上就是找所有线程中非活跃的
    const availableWorker = this.workers.find((w) => !this.activeWorkers.has(w))
    if (!availableWorker) return
    // 取出一个任务 并放入活跃列表
    const task = this.taskQueue.shift()!
    this.activeWorkers.set(availableWorker, task)
    // 向 Worker 发送计算指令
    availableWorker.postMessage({
      type: 'calculate',
      fileId: task.id,
      file: task.data,
    })
  }

  //提交任务
  // 将任务封装成promise对象 放入任务队列 并执行队列
  execute<T>(id: string, data: unknown, onProgress?: (progress: number) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      const task: Task<unknown> = {
        id,
        data,
        resolve: resolve as (value: unknown) => void,
        reject,
        onProgress,
      }

      this.taskQueue.push(task)
      this.processQueue()
    })
  }
  // 销毁线程池
  terminate() {
    this.workers.forEach((w) => w.terminate())
    this.workers = []
    this.taskQueue = []
    this.activeWorkers.clear()
  }
}
