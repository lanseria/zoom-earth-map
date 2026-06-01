<script setup lang="ts">
import { useTimelineStore } from '~/composables/timeline'

const timelineStore = useTimelineStore()
const isPanelOpen = ref(false)

function formatWindTime(ts: number) {
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  })
}

const windTimeOptions = computed(() =>
  timelineStore.windTimestamps.map(ts => ({ value: ts, label: formatWindTime(ts) })),
)

function togglePanel() {
  isPanelOpen.value = !isPanelOpen.value
  if (isPanelOpen.value)
    timelineStore.fetchWindManifests()
}

const opts = computed(() => timelineStore.windOptions)
</script>

<template>
  <div class="pointer-events-auto right-4 top-40 absolute">
    <!-- 风力图层触发按钮 -->
    <button
      class="icon-btn rounded-full bg-dark-800/70 flex h-10 w-10 items-center justify-center backdrop-blur-sm !text-2xl"
      title="风力图层"
      @click="togglePanel"
    >
      <div :class="isPanelOpen ? 'i-carbon-close' : 'i-carbon-windy'" />
    </button>

    <!-- 风力图层面板 -->
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
        class="text-white p-4 rounded-lg bg-dark-800/80 w-72 shadow-lg right-12 top-0 absolute backdrop-blur-sm"
      >
        <div class="space-y-3">
          <div>
            <h3 class="text-lg font-semibold mb-2 pb-1 border-b border-gray-500/50">
              风力图层（850 hPa）
            </h3>
            <!-- 总开关 -->
            <div class="flex items-center justify-between">
              <label class="text-sm">显示图层</label>
              <button
                class="p-1 rounded-full h-6 w-12 transition-colors duration-300"
                :class="timelineStore.showWind ? 'bg-sky-600' : 'bg-gray-600'"
                @click="timelineStore.showWind = !timelineStore.showWind"
              >
                <span
                  class="rounded-full bg-white h-4 w-4 block shadow transform transition-transform duration-300"
                  :class="{ 'translate-x-6': timelineStore.showWind }"
                />
              </button>
            </div>
            <!-- 时间选择 -->
            <div v-if="timelineStore.showWind" class="mt-2">
              <select
                v-model.number="timelineStore.selectedWindTimestamp"
                class="text-sm text-white px-2 py-1.5 outline-none border border-gray-600/50 rounded bg-dark-900/80 w-full focus:border-sky-500"
              >
                <option v-for="opt in windTimeOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </div>
          </div>

          <!-- 粒子参数控制 -->
          <template v-if="timelineStore.showWind">
            <div class="pt-1 border-t border-gray-500/50 space-y-2.5">
              <div class="text-xs text-gray-400 font-semibold">
                粒子参数
              </div>

              <!-- 流动速度 -->
              <div>
                <div class="text-xs mb-1 flex justify-between">
                  <span class="text-gray-300">流动速度</span>
                  <span class="text-gray-400">{{ opts.velocityScale.toFixed(3) }}</span>
                </div>
                <input
                  v-model.number="opts.velocityScale"
                  type="range"
                  min="0.001"
                  max="0.01"
                  step="0.001"
                  class="wind-slider"
                >
              </div>

              <!-- 拖尾长度 -->
              <div>
                <div class="text-xs mb-1 flex justify-between">
                  <span class="text-gray-300">拖尾长度</span>
                  <span class="text-gray-400">{{ opts.fadeOpacity.toFixed(2) }}</span>
                </div>
                <input
                  v-model.number="opts.fadeOpacity"
                  type="range"
                  min="0.75"
                  max="0.99"
                  step="0.01"
                  class="wind-slider"
                >
              </div>

              <!-- 粒子密度 -->
              <div>
                <div class="text-xs mb-1 flex justify-between">
                  <span class="text-gray-300">粒子密度</span>
                  <span class="text-gray-400">{{ opts.particleCount.toLocaleString() }}</span>
                </div>
                <input
                  v-model.number="opts.particleCount"
                  type="range"
                  min="500"
                  max="15000"
                  step="500"
                  class="wind-slider"
                >
              </div>

              <!-- 线条粗细 -->
              <div>
                <div class="text-xs mb-1 flex justify-between">
                  <span class="text-gray-300">线条粗细</span>
                  <span class="text-gray-400">{{ opts.lineWidth.toFixed(1) }} px</span>
                </div>
                <input
                  v-model.number="opts.lineWidth"
                  type="range"
                  min="0.5"
                  max="5"
                  step="0.5"
                  class="wind-slider"
                >
              </div>

              <!-- 粒子寿命 -->
              <div>
                <div class="text-xs mb-1 flex justify-between">
                  <span class="text-gray-300">粒子寿命</span>
                  <span class="text-gray-400">{{ opts.maxAge }}</span>
                </div>
                <input
                  v-model.number="opts.maxAge"
                  type="range"
                  min="10"
                  max="200"
                  step="10"
                  class="wind-slider"
                >
              </div>

              <!-- 风速着色 -->
              <div class="pt-1 flex items-center justify-between">
                <span class="text-xs text-gray-300">风速着色</span>
                <button
                  class="p-1 rounded-full h-5 w-10 transition-colors duration-300"
                  :class="opts.colorBySpeed ? 'bg-sky-600' : 'bg-gray-600'"
                  @click="opts.colorBySpeed = !opts.colorBySpeed"
                >
                  <span
                    class="rounded-full bg-white h-3 w-3 block shadow transform transition-transform duration-300"
                    :class="{ 'translate-x-5': opts.colorBySpeed }"
                  />
                </button>
              </div>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.wind-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.15);
  outline: none;
}

.wind-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #38bdf8;
  cursor: pointer;
  border: 2px solid rgba(255, 255, 255, 0.3);
}

.wind-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #38bdf8;
  cursor: pointer;
  border: 2px solid rgba(255, 255, 255, 0.3);
}
</style>
