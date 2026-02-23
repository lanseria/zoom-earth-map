<script setup lang="ts">
import type { AnimationDuration, AnimationSpeed, AnimationStyle, TimelineControlStyle } from '~/composables/timeline'
import { useTimelineStore } from '~/composables/timeline'
import { MAP_STYLE_OPTIONS } from '~/constants/map'

const timelineStore = useTimelineStore()
const isPanelOpen = ref(false)

const speedOptions: { label: string, value: AnimationSpeed }[] = [
  { label: '慢', value: 'slow' },
  { label: '中等', value: 'medium' },
  { label: '快速', value: 'fast' },
]

const durationOptions: { label: string, value: AnimationDuration }[] = [
  { label: '3h', value: 3 },
  { label: '6h', value: 6 },
  { label: '12h', value: 12 },
  { label: '24h', value: 24 },
]

const styleOptions: { label: string, value: AnimationStyle, description: string }[] = [
  { label: '快速', value: 'fast', description: '实时加载，可能会有卡顿' },
  { label: '平滑', value: 'smooth', description: '预加载资源，播放流畅' },
]

const controlStyleOptions: { label: string, value: TimelineControlStyle }[] = [
  { label: '经典', value: 'classic' },
  { label: '刻度尺', value: 'ruler' },
]

const projectionOptions: { label: string, value: MapProjection }[] = [
  { label: '平面', value: 'mercator' },
  { label: '地球', value: 'globe' },
]
</script>

<template>
  <div class="pointer-events-auto right-4 top-4 absolute">
    <!-- 设置触发按钮 -->
    <button
      class="icon-btn rounded-full bg-dark-800/70 flex h-10 w-10 items-center justify-center backdrop-blur-sm !text-2xl"
      title="设置"
      @click="isPanelOpen = !isPanelOpen"
    >
      <div :class="isPanelOpen ? 'i-carbon-close' : 'i-carbon-settings'" />
    </button>

    <!-- 设置面板 -->
    <Transition
      enter-from-class="opacity-0 translate-x-4"
      enter-to-class="opacity-100 translate-x-0"
      leave-active-class="transition-all duration-200 ease-in"
      leave-from-class="opacity-100 translate-x-0"
      leave-to-class="opacity-0 translate-x-4"
      enter-active-class="transition-all duration-200 ease-out"
    >
      <div
        v-if="isPanelOpen"
        class="text-white p-4 rounded-lg bg-dark-800/80 w-64 shadow-lg right-12 top-0 absolute backdrop-blur-sm"
      >
        <div class="space-y-4">
          <!-- --- 视图模式 Box --- -->
          <div>
            <h3 class="text-lg font-semibold mb-2 pb-1 border-b border-gray-500/50">
              视图模式
            </h3>
            <div class="p-0.5 rounded-md bg-dark-900/50 flex items-center">
              <button
                v-for="opt in projectionOptions"
                :key="opt.value"
                class="text-sm px-3 py-1 rounded flex-1 transition-colors duration-200"
                :class="{ 'bg-sky-600 text-white': timelineStore.mapProjection === opt.value, 'hover:bg-gray-600/50': timelineStore.mapProjection !== opt.value }"
                @click="timelineStore.setMapProjection(opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>
          <!-- 底图模式 Box -->
          <div>
            <h3 class="text-lg font-semibold mb-2 pb-1 border-b border-gray-500/50">
              底图模式
            </h3>
            <div class="p-0.5 rounded-md bg-dark-900/50 gap-0.5 grid grid-cols-2">
              <button
                v-for="opt in MAP_STYLE_OPTIONS"
                :key="opt.id"
                class="text-sm px-3 py-1 rounded transition-colors duration-200"
                :class="{ 'bg-sky-600 text-white': timelineStore.activeBaseMap === opt.id, 'hover:bg-gray-600/50': timelineStore.activeBaseMap !== opt.id }"
                @click="timelineStore.setActiveBaseMap(opt.id)"
              >
                {{ opt.name }}
              </button>
            </div>
          </div>
          <!-- 图层显示 Box -->
          <div>
            <h3 class="text-lg font-semibold mb-2 pb-1 border-b border-gray-500/50">
              图层显示
            </h3>
            <!-- 显示国界 -->
            <div class="mt-3 flex items-center justify-between">
              <label for="show-boundaries" class="text-sm">显示国界</label>
              <button
                class="p-1 rounded-full h-6 w-12 transition-colors duration-300"
                :class="timelineStore.showBoundaries ? 'bg-sky-600' : 'bg-gray-600'"
                @click="timelineStore.showBoundaries = !timelineStore.showBoundaries"
              >
                <span
                  class="rounded-full bg-white h-4 w-4 block shadow transform transition-transform duration-300"
                  :class="{ 'translate-x-6': timelineStore.showBoundaries }"
                />
              </button>
            </div>
            <!-- 显示城市 -->
            <div class="mt-3 flex items-center justify-between">
              <label for="show-cities" class="text-sm">显示城市</label>
              <button
                class="p-1 rounded-full h-6 w-12 transition-colors duration-300"
                :class="timelineStore.showCities ? 'bg-sky-600' : 'bg-gray-600'"
                @click="timelineStore.showCities = !timelineStore.showCities"
              >
                <span
                  class="rounded-full bg-white h-4 w-4 block shadow transform transition-transform duration-300"
                  :class="{ 'translate-x-6': timelineStore.showCities }"
                />
              </button>
            </div>
          </div>
          <!-- 动画 Box -->
          <div>
            <h3 class="text-lg font-semibold mb-2 pb-1 border-b border-gray-500/50">
              动画
            </h3>
            <!-- 时间轴样式 -->
            <div class="mb-3 flex items-center justify-between">
              <label for="control-style" class="text-sm">控制样式</label>
              <div class="p-0.5 rounded-md bg-dark-900/50 flex items-center">
                <button
                  v-for="opt in controlStyleOptions"
                  :key="opt.value"
                  class="text-sm px-3 py-1 rounded transition-colors duration-200"
                  :class="{ 'bg-sky-600 text-white': timelineStore.controlStyle === opt.value, 'hover:bg-gray-600/50': timelineStore.controlStyle !== opt.value }"
                  @click="timelineStore.controlStyle = opt.value"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>

            <!-- 动画速度 -->
            <div class="flex items-center justify-between">
              <label for="animation-speed" class="text-sm">动画速度</label>
              <div class="p-0.5 rounded-md bg-dark-900/50 flex items-center">
                <button
                  v-for="opt in speedOptions"
                  :key="opt.value"
                  class="text-sm px-3 py-1 rounded transition-colors duration-200"
                  :class="{ 'bg-sky-600 text-white': timelineStore.animationSpeed === opt.value, 'hover:bg-gray-600/50': timelineStore.animationSpeed !== opt.value }"
                  @click="timelineStore.animationSpeed = opt.value"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>

            <!-- 动画时长 -->
            <div class="mt-3 flex items-center justify-between">
              <label for="animation-duration" class="text-sm">动画时长</label>
              <div class="p-0.5 rounded-md bg-dark-900/50 flex items-center">
                <button
                  v-for="opt in durationOptions"
                  :key="opt.value"
                  class="text-sm px-2.5 py-1 rounded transition-colors duration-200"
                  :class="{ 'bg-sky-600 text-white': timelineStore.animationDuration === opt.value, 'hover:bg-gray-600/50': timelineStore.animationDuration !== opt.value }"
                  @click="timelineStore.animationDuration = opt.value"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>

            <!-- 动画风格 -->
            <div class="mt-3 flex items-center justify-between">
              <label for="animation-style" class="text-sm">动画风格</label>
              <div class="p-0.5 rounded-md bg-dark-900/50 flex items-center">
                <button
                  v-for="opt in styleOptions"
                  :key="opt.value"
                  class="text-sm px-3 py-1 rounded transition-colors duration-200"
                  :class="{ 'bg-sky-600 text-white': timelineStore.animationStyle === opt.value, 'hover:bg-gray-600/50': timelineStore.animationStyle !== opt.value }"
                  :title="opt.description"
                  @click="timelineStore.animationStyle = opt.value"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>

            <!-- 循环播放 -->
            <div class="mt-3 flex items-center justify-between">
              <label for="loop-playback" class="text-sm">循环播放</label>
              <button
                class="p-1 rounded-full h-6 w-12 transition-colors duration-300"
                :class="timelineStore.loopPlayback ? 'bg-sky-600' : 'bg-gray-600'"
                @click="timelineStore.loopPlayback = !timelineStore.loopPlayback"
              >
                <span
                  class="rounded-full bg-white h-4 w-4 block shadow transform transition-transform duration-300"
                  :class="{ 'translate-x-6': timelineStore.loopPlayback }"
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
