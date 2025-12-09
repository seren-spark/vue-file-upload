<script setup lang="ts">
import { UploadFilled } from '@element-plus/icons-vue'
import { ref } from 'vue'
import FileList, { type FileItem } from './FileList.vue'
import { useUpload } from '@/composables/useUpload'
import axios from 'axios'
import { UploadStatus, type UploadFileInfo } from '@/types/upload'
// const files = ref<FileItem[]>([
//   { id: 1, name: 'document.pdf', status: 'uploading', progress: 60 },
//   { id: 2, name: 'image.png', status: 'success', size: '2.5 MB' },
//   { id: 3, name: 'video.mp4', status: 'error', error: '文件过大' },
// ])

const { files, addFiles, pause, resume, cancel, retry } = useUpload({
  chunkSize: 5 * 1024 * 1024, // 5MB
  maxConcurrent: 3,
  maxRetries: 3,
})

const handleFileChange = (uploadFile: { raw: File }) => {
  console.log(uploadFile.raw, '文件变化')
  if (uploadFile.raw) {
    addFiles([uploadFile.raw])
  }
}
const handleCancel = (file: UploadFileInfo) => {
  console.log('取消', file)
  if (file.status === UploadStatus.PENDING) {
    pause(file.id)
  } else {
    cancel(file.id)
  }
}
// fileItem 和这个类型 UploadFileInfo 有什么区别
const handlePreview = (file: UploadFileInfo) => console.log('预览', file)
const handleDelete = (file: UploadFileInfo) => cancel(file.id as string)
const handleRetry = (file: UploadFileInfo) => retry(file.id as string)
</script>
<template>
  <div class="file-upload">
    <!-- 上传区域 -->
    <!-- <div class="upload-area">
      <div class="upload-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <el-icon class="el-icon--upload"><upload-filled /></el-icon>
      </div>
      <div class="upload-text">
        <span class="upload-title">拖拽文件到此处上传</span>
        <span class="upload-hint">或点击选择文件</span>
      </div>
      <div class="upload-limit">支持 jpg、png、pdf 格式，单个文件不超过 10MB</div>
    </div> -->
    <el-upload
      class="upload-area"
      drag
      action="#"
      :auto-upload="false"
      :show-file-list="false"
      multiple
      :on-change="handleFileChange"
    >
      <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
      <div class="el-upload__text">拖拽文件到此处上传 <em>或点击选择文件</em></div>
      <template #tip>
        <div class="el-upload__tip">支持 任何格式</div>
      </template>
    </el-upload>
    <!-- 文件列表组件  :files="files"-->
    <FileList
      class="file-list-wrapper"
      :files="files"
      @cancel="handleCancel"
      @preview="handlePreview"
      @delete="handleDelete"
      @retry="handleRetry"
      @pause="(file) => pause(file.id)"
      @resume="(file) => resume(file.id)"
    />
  </div>
</template>

<style lang="scss" scoped>
// 变量定义
$primary-color: #409eff;
$text-color: #303133;
$text-secondary: #909399;
$border-color: #dcdfe6;
$bg-color: #f5f7fa;
$radius: 8px;
$transition: all 0.3s ease;

.file-upload {
  width: 100%;
  max-width: 500px;
}

.upload-area {
  width: 100%;

  :deep(.el-upload-dragger) {
    width: 100%;
    padding: 40px 20px;
  }

  :deep(.el-icon--upload) {
    font-size: 48px;
    color: #909399;
    margin-bottom: 16px;
    transition: color 0.3s;
  }

  :deep(.el-upload-dragger:hover .el-icon--upload) {
    color: #409eff;
  }

  :deep(.el-upload__text) {
    color: #606266;
    font-size: 14px;

    em {
      color: #409eff;
      font-style: normal;
    }
  }

  :deep(.el-upload__tip) {
    font-size: 12px;
    color: #909399;
    margin-top: 8px;
    text-align: center;
  }
}

.file-list-wrapper {
  margin-top: 16px;
}
</style>
