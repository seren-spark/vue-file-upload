<template>
  <div class="file-list" v-if="files.length">
    <div v-for="file in files" class="file-item" :key="file.id" :class="file.status">
      <div class="file-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      </div>
      <div class="file-info">
        <div class="file-name">{{ file.name }}</div>
        <div class="file-meta">
          <span>{{ formatSize(file.size) }}</span>
          <span class="status-text">{{ getStatusText(file.status) }}</span>
          <span v-if="file.status === UploadStatus.UPLOADING && file.speed">
            {{ formatSpeed(file.speed) }} · 剩余 {{ formatTime(file.remainingTime) }}
          </span>
        </div>

        <!-- MD5计算进度 -->
        <div v-if="file.status === UploadStatus.HASHING" class="progress-wrapper">
          <el-progress
            :percentage="file.hashProgress"
            :stroke-width="6"
            :show-text="false"
            status="warning"
          />
          <span class="progress-text">MD5: {{ file.hashProgress }}%</span>
        </div>

        <!-- <div v-else-if="isUploading(file.status)" class="file-progress">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: file.progress + '%' }"></div>
          </div>
          <span class="progress-text">{{ file.progress }}%</span>
        </div> -->
        <!-- 成功：显示文件大小 -->
        <!-- <div v-else-if="file.status === 'success'" class="file-size">
          {{ formatSize(file.size) }}
        </div> -->
        <!-- <div v-else-if="file.status === 'error'" class="file-error">上传失败，请重试</div> -->

        <div
          v-else-if="file.status === UploadStatus.UPLOADING || file.status === UploadStatus.PAUSED"
          class="progress-wrapper"
        >
          <el-progress
            :percentage="file.progress"
            :stroke-width="6"
            :show-text="false"
            :status="file.status === UploadStatus.PAUSED ? 'warning' : undefined"
          />
          <span class="progress-text">{{ file.progress }}%</span>
        </div>
      </div>

      <div class="file-actions">
        <!-- 上传中：取消按钮 -->
        <!-- <button
          v-if="file.status === 'uploading'"
          class="btn-cancel"
          title="取消"
          @click="$emit('cancel', file)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button> -->

        <!-- 成功：预览和删除 -->
        <!-- <template v-else-if="file.status === 'success'">
          <button class="btn-preview" title="预览" @click="$emit('preview', file)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
          <button class="btn-delete" title="删除" @click="$emit('delete', file)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6" />
              <path
                d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
              />
            </svg>
          </button>
        </template> -->
        <!-- 失败：重试和删除 -->
        <!-- <template v-else-if="file.status === 'error'">
          <button class="btn-retry" title="重试" @click="$emit('retry', file)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
          <button class="btn-delete" title="删除" @click="$emit('delete', file)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6" />
              <path
                d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
              />
            </svg>
          </button>
        </template> -->

        <!-- 上传中：暂停/取消 -->
        <template v-if="file.status === UploadStatus.UPLOADING">
          <el-button size="small" @click="pause(file.id)">暂停</el-button>
          <el-button size="small" type="danger" @click="cancel(file.id)">取消</el-button>
        </template>

        <!-- 暂停：继续/取消 -->
        <template v-else-if="file.status === UploadStatus.PAUSED">
          <el-button size="small" type="primary" @click="resume(file.id)">继续</el-button>
          <el-button size="small" type="danger" @click="cancel(file.id)">取消</el-button>
        </template>

        <!-- 失败：重试/删除 -->
        <template v-else-if="file.status === UploadStatus.ERROR">
          <el-button size="small" type="warning" @click="retry(file.id)">重试</el-button>
          <el-button size="small" type="danger" @click="cancel(file.id)">删除</el-button>
        </template>

        <!-- 成功：删除 -->
        <template v-else-if="file.status === UploadStatus.SUCCESS">
          <el-button size="small" type="danger" @click="cancel(file.id)">删除</el-button>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { UploadStatus, type UploadFileInfo } from '@/types/upload'
export interface FileItem {
  id: string | number
  name: string
  status: 'uploading' | 'success' | 'error'
  progress?: number
  size?: string
  error?: string
}
const props = defineProps<{
  files: UploadFileInfo[]
}>()
const emit = defineEmits<{
  cancel: [file: UploadFileInfo]
  preview: [file: UploadFileInfo]
  delete: [file: UploadFileInfo]
  retry: [file: UploadFileInfo]
  pause: [file: UploadFileInfo]
  resume: [file: UploadFileInfo]
}>()
// 操作方法
const pause = (fileId: string) => {
  const file = props.files.find((f) => f.id === fileId)
  if (file) emit('pause', file)
}

const resume = (fileId: string) => {
  const file = props.files.find((f) => f.id === fileId)
  if (file) emit('resume', file)
}

const cancel = (fileId: string) => {
  const file = props.files.find((f) => f.id === fileId)
  if (file) emit('cancel', file)
}

const retry = (fileId: string) => {
  const file = props.files.find((f) => f.id === fileId)
  if (file) emit('retry', file)
}
// 辅助函数
const isUploading = (status: UploadStatus) =>
  [
    UploadStatus.UPLOADING,
    UploadStatus.HASHING,
    UploadStatus.CHECKING,
    UploadStatus.MERGING,
  ].includes(status)

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

const getStatusText = (status: UploadStatus): string => {
  const map: Record<UploadStatus, string> = {
    [UploadStatus.PENDING]: '等待中',
    [UploadStatus.HASHING]: '计算MD5',
    [UploadStatus.CHECKING]: '秒传检测',
    [UploadStatus.UPLOADING]: '上传中',
    [UploadStatus.MERGING]: '合并中',
    [UploadStatus.SUCCESS]: '上传成功',
    [UploadStatus.ERROR]: '上传失败',
    [UploadStatus.PAUSED]: '已暂停',
    [UploadStatus.CANCELLED]: '已取消',
  }
  return map[status] || status
}

const formatSpeed = (bytesPerSecond?: number): string => {
  if (!bytesPerSecond) return '--'
  return formatSize(bytesPerSecond) + '/s'
}

const formatTime = (seconds?: number): string => {
  if (!seconds || !isFinite(seconds)) return '--'
  if (seconds < 60) return Math.round(seconds) + '秒'
  if (seconds < 3600) return Math.round(seconds / 60) + '分钟'
  return Math.round(seconds / 3600) + '小时'
}
</script>

<style lang="scss" scoped>
// 变量定义
$primary-color: #409eff;
$success-color: #67c23a;
$error-color: #f56c6c;
$warning-color: #e6a23c;
$text-color: #303133;
$text-secondary: #909399;
$border-color: #dcdfe6;
$bg-color: #f5f7fa;
$radius: 8px;
$transition: all 0.3s ease;

// 文件列表
.file-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background-color: #fff;
  border: 1px solid $border-color;
  border-radius: $radius;
  transition: $transition;

  &:hover {
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  }

  // 上传中状态
  &.uploading {
    .file-icon {
      color: $primary-color;
      animation: pulse 1.5s ease-in-out infinite;
    }
  }

  // 成功状态
  &.success {
    border-color: rgba($success-color, 0.3);
    background-color: rgba($success-color, 0.04);

    .file-icon {
      color: $success-color;
    }
  }

  // 失败状态
  &.error {
    border-color: rgba($error-color, 0.3);
    background-color: rgba($error-color, 0.04);

    .file-icon {
      color: $error-color;
    }
  }
}

.file-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  color: $text-secondary;

  svg {
    width: 100%;
    height: 100%;
  }
}

.file-info {
  flex: 1;
  min-width: 0;
}

.file-name {
  font-size: 14px;
  font-weight: 500;
  color: $text-color;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-size {
  font-size: 12px;
  color: $text-secondary;
  margin-top: 2px;
}

.file-error {
  font-size: 12px;
  color: $error-color;
  margin-top: 2px;
}

// 进度条
.file-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.progress-bar {
  flex: 1;
  height: 6px;
  background-color: $bg-color;
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, $primary-color, lighten($primary-color, 10%));
  border-radius: 3px;
  transition: width 0.3s ease;
  animation: progress-shine 1.5s ease-in-out infinite;
}

.progress-text {
  flex-shrink: 0;
  font-size: 12px;
  color: $primary-color;
  font-weight: 500;
  min-width: 36px;
  text-align: right;
}

// 操作按钮
.file-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;

  button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 6px;
    background-color: transparent;
    cursor: pointer;
    transition: $transition;

    svg {
      width: 16px;
      height: 16px;
    }
  }

  .btn-preview {
    color: $primary-color;

    &:hover {
      background-color: rgba($primary-color, 0.1);
    }
  }

  .btn-delete,
  .btn-cancel {
    color: $text-secondary;

    &:hover {
      color: $error-color;
      background-color: rgba($error-color, 0.1);
    }
  }

  .btn-retry {
    color: $warning-color;

    &:hover {
      background-color: rgba($warning-color, 0.1);
    }
  }
}

// 补充样式
.file-meta {
  display: flex;
  gap: 12px;
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
}

.status-text {
  color: #409eff;
}

.progress-wrapper {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;

  .el-progress {
    flex: 1;
  }

  .progress-text {
    font-size: 12px;
    color: #409eff;
    min-width: 60px;
    text-align: right;
  }
}

.file-actions {
  display: flex;
  gap: 8px;
  margin-left: 16px;
}

// 动画
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

@keyframes progress-shine {
  0% {
    opacity: 1;
  }
  50% {
    opacity: 0.8;
  }
  100% {
    opacity: 1;
  }
}
</style>
