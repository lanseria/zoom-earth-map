<script setup>
import { useTimelineStore } from '~/composables/timeline'

// 获取 GIS 服务器 URL
const runtimeConfig = useRuntimeConfig()
const gisServerUrl = runtimeConfig.public.gisServerUrl

// 实例化 store
const timelineStore = useTimelineStore()

// --- 生命周期钩子 ---
onMounted(() => {
  // 触发 store 中的 action 来获取数据
  timelineStore.fetchTimestamps()
})

onUnmounted(() => {
  // 调用 store 中的 cleanup action
  timelineStore.cleanup()
})
</script>

<template>
  <div class="font-sans h-screen w-screen relative">
    <!-- 地图容器，直接从 store 获取数据 -->
    <MapViewer
      v-if="timelineStore.timestamps.length > 0"
      :selected-timestamp="timelineStore.selectedTimestamp"
      :server-url="gisServerUrl"
    />
    <!-- 加载状态，也从 store 获取 -->
    <div v-else class="text-lg text-gray-400 bg-dark-900 flex h-full w-full items-center justify-center">
      <p>{{ timelineStore.statusMessage }}</p>
    </div>

    <!-- UI 覆盖层 -->
    <div v-if="timelineStore.timestamps.length > 0" class="pointer-events-none inset-0 absolute">
      <!-- 这两个组件现在都独立了，MapHeader 不变，TimelineControl 自行与 store 通信 -->
      <MapHeader />
      <TimelineControl />
    </div>
  </div>
</template>
