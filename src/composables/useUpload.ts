import { ref, reactive, computed, onUnmounted } from 'vue'
import { UploadService } from '@/utils/upload'
import type { UploadFileInfo, UploadConfig, UploadEvents } from '@/types/upload'
import { UploadStatus } from '@/types/upload'

export function useUpload(config: Partial<UploadConfig> = {}) {
  const files = ref<UploadFileInfo[]>([])
  const isUploading = computed(() =>
    files.value.some(
      (f) =>
        f.status === UploadStatus.UPLOADING ||
        f.status === UploadStatus.HASHING ||
        f.status === UploadStatus.MERGING,
    ),
  )

  const events: UploadEvents = {
    onProgress: (file) => {
      const index = files.value.findIndex((f) => f.id === file.id)
      if (index !== -1) {
        files.value[index] = { ...file }
      }
    },
    onHashProgress: (file) => {
      const index = files.value.findIndex((f) => f.id === file.id)
      if (index !== -1) {
        files.value[index] = { ...file }
      }
    },
    onStatusChange: (file) => {
      const index = files.value.findIndex((f) => f.id === file.id)
      if (index !== -1) {
        files.value[index] = { ...file }
      }
    },
    onSuccess: (file, url) => {
      console.log('上传成功:', file.name, url)
    },
    onError: (file, error) => {
      console.error('上传失败:', file.name, error)
    },
  }

  const uploadService = new UploadService(config, events)

  // 添加文件
  const addFiles = async (fileList: FileList | File[]) => {
    const newFiles = Array.from(fileList)

    for (const file of newFiles) {
      const fileInfo = await uploadService.addFile(file)
      files.value.push(fileInfo)

      // 自动开始上传
      uploadService.startUpload(fileInfo)
    }
  }

  // 暂停
  const pause = (fileId: string) => {
    const file = files.value.find((f) => f.id === fileId)
    if (file) {
      uploadService.pauseUpload(file)
    }
  }

  // 恢复
  const resume = (fileId: string) => {
    const file = files.value.find((f) => f.id === fileId)
    if (file) {
      uploadService.resumeUpload(file)
    }
  }

  // 取消
  const cancel = (fileId: string) => {
    const file = files.value.find((f) => f.id === fileId)
    if (file) {
      uploadService.cancelUpload(file)
      files.value = files.value.filter((f) => f.id !== fileId)
    }
  }

  // 重试
  const retry = (fileId: string) => {
    const file = files.value.find((f) => f.id === fileId)
    if (file) {
      uploadService.resumeUpload(file)
    }
  }

  // 清理
  onUnmounted(() => {
    uploadService.destroy()
  })

  return {
    files,
    isUploading,
    addFiles,
    pause,
    resume,
    cancel,
    retry,
  }
}
