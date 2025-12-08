<script setup lang="ts">
import FileUpload from './components/FileUpload.vue'
</script>

<template>
  <div class="container">
    <h1>文件上传组件</h1>
    <FileUpload />
  </div>
</template>

<style scoped>
.container {
  max-width: 600px;
  margin: 40px auto;
  padding: 20px;
}

h1 {
  font-size: 24px;
  color: #303133;
  margin-bottom: 24px;
  text-align: center;
}
</style>
