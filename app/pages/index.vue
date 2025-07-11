<script setup>
import MapViewer from '~/components/MapViewer.vue'
import { useTimelineStore } from '~/composables/timeline'

// 获取 GIS 服务器 URL
const runtimeConfig = useRuntimeConfig()
const gisServerUrl = runtimeConfig.public.gisServerUrl
const mapViewerRef = useTemplateRef('mapViewerRef')

// 实例化 store
const timelineStore = useTimelineStore()

// --- 生命周期钩子 ---
onMounted(async () => {
  // 触发 store 中的 action 来获取数据
  await timelineStore.fetchTimestamps()
  nextTick(() => {
    timelineStore.setMapViewerInstance(mapViewerRef.value)
  })
})

onUnmounted(() => {
  timelineStore.cleanup()
})
</script>

<template>
  <div class="font-sans h-screen w-screen relative">
    <!-- 地图容器，直接从 store 获取数据 -->
    <MapViewer
      v-if="timelineStore.timestamps.length > 0"
      ref="mapViewerRef"
      :selected-timestamp="timelineStore.selectedTimestamp"
      :server-url="gisServerUrl"
      :animation-style="timelineStore.animationStyle"
    />
    <!-- 加载状态，也从 store 获取 -->
    <div v-else class="text-lg text-gray-400 bg-dark-900 flex h-full w-full items-center justify-center">
      <p>{{ timelineStore.statusMessage }}</p>
    </div>
    <!-- UI 覆盖层，增加一个加载动画的提示 -->
    <div v-if="timelineStore.timestamps.length > 0" class="pointer-events-none inset-0 absolute">
      <MapHeader />
      <TimelineControl />
      <SettingsPanel />
      <!-- 平滑动画加载指示器 -->
      <!-- 平滑动画加载指示器 (Toast 样式) -->
      <Transition
        enter-from-class="opacity-0 -translate-y-full"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition-all duration-300 ease-in"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 -translate-y-full"
        enter-active-class="transition-all duration-300 ease-out"
      >
        <div v-if="timelineStore.isPreloading" class="text-white px-4 py-2 rounded-lg bg-dark-800/80 flex pointer-events-auto shadow-lg items-center left-1/2 top-4 absolute backdrop-blur-sm -translate-x-1/2">
          <div class="i-carbon-circle-dash text-xl mr-3 animate-spin" />
          <p>{{ timelineStore.statusMessage }}</p>
        </div>
      </Transition>
    </div>
  </div>
</template>
