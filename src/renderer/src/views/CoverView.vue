<template>
  <div class="cover-page">
    <div class="cover-card">
      <img v-if="appIconDataUrl" class="app-icon" :src="appIconDataUrl" alt="App Icon" />
      <div v-else class="app-mark">AI</div>
      <h1>{{ appName }}</h1>
      <p>桌面智能助理</p>
      <div class="actions">
        <el-button type="primary" @click="openSettings">进入设置中心</el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const appName = ref('AI Bot')
const appIconDataUrl = ref('')

onMounted(async () => {
  try {
    const meta = await window.electronAPI.app.getMeta()
    if (meta?.name) appName.value = meta.name
    if (meta?.iconDataUrl) appIconDataUrl.value = meta.iconDataUrl
  } catch {
    // keep fallback values
  }
})

function openSettings() {
  router.push('/')
}
</script>

<style scoped>
.cover-page {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(780px 340px at 20% 0%, rgba(15, 118, 110, 0.2), transparent 60%),
    radial-gradient(720px 320px at 100% 0%, rgba(217, 119, 6, 0.15), transparent 58%),
    linear-gradient(180deg, #f8fafb 0%, #eef3f4 100%);
}

.cover-card {
  width: min(460px, 92vw);
  padding: 34px 28px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.86);
  border: 1px solid rgba(15, 23, 42, 0.1);
  box-shadow: 0 18px 36px rgba(15, 23, 42, 0.12);
  text-align: center;
}

.app-mark {
  width: 74px;
  height: 74px;
  margin: 0 auto 14px;
  border-radius: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #0f766e, #115e59);
  box-shadow: 0 10px 20px rgba(15, 118, 110, 0.3);
}

.app-icon {
  width: 74px;
  height: 74px;
  margin: 0 auto 14px;
  object-fit: contain;
  border-radius: 16px;
  box-shadow: 0 10px 20px rgba(15, 23, 42, 0.2);
}

h1 {
  margin: 0;
  font-size: 30px;
  color: #1f2937;
}

p {
  margin: 8px 0 0;
  font-size: 14px;
  color: #475569;
}

.actions {
  margin-top: 24px;
}
</style>
