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

        <div v-if="file.status === 'uploading'" class="file-progress">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: file.progress + '%' }"></div>
          </div>
          <span class="progress-text">{{ file.progress }}%</span>
        </div>
        <!-- 成功：显示文件大小 -->
        <div v-else-if="file.status === 'success'" class="file-size">{{ file.size }}</div>
        <div v-else-if="file.status === 'error'" class="file-error">上传失败，请重试</div>
      </div>

      <div class="file-actions">
        <!-- 上传中：取消按钮 -->
        <button
          v-if="file.status === 'uploading'"
          class="btn-cancel"
          title="取消"
          @click="$emit('cancel', file)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <!-- 成功：预览和删除 -->
        <template v-else-if="file.status === 'success'">
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
        </template>
        <!-- 失败：重试和删除 -->
        <template v-else-if="file.status === 'error'">
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
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
export interface FileItem {
  id: string | number
  name: string
  status: 'uploading' | 'success' | 'error'
  progress?: number
  size?: string
  error?: string
}
defineProps<{
  files: FileItem[]
}>()
defineEmits<{
  cancel: [file: FileItem]
  preview: [file: FileItem]
  delete: [file: FileItem]
  retry: [file: FileItem]
}>()
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
