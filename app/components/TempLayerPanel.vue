<script setup lang="ts">
import type { TempVariable } from '~/composables/timeline'
import { useTimelineStore } from '~/composables/timeline'

const timelineStore = useTimelineStore()
const isPanelOpen = ref(false)

const TEMP_VARIABLES: { value: TempVariable, label: string, unit: string }[] = [
  { value: 'temp', label: '温度', unit: '°C' },
  { value: 'rh', label: '相对湿度', unit: '%' },
]

const currentVariable = computed(() =>
  TEMP_VARIABLES.find(v => v.value === timelineStore.tempVariable) ?? TEMP_VARIABLES[0]!,
)

async function selectVariable(v: TempVariable) {
  if (timelineStore.tempVariable === v)
    return
  timelineStore.tempVariable = v
  timelineStore.resetTempManifests()
  if (timelineStore.showTemp)
    await timelineStore.fetchTempManifests()
}

function formatTempTime(ts: number) {
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  })
}

const tempTimeOptions = computed(() =>
  timelineStore.tempTimestamps.map(ts => ({ value: ts, label: formatTempTime(ts) })),
)

async function togglePanel() {
  isPanelOpen.value = !isPanelOpen.value
  if (isPanelOpen.value && timelineStore.tempTimestamps.length === 0)
    await timelineStore.fetchTempManifests()
}
</script>

<template>
  <div class="pointer-events-auto right-4 top-52 absolute">
    <!-- 温度图层触发按钮 -->
    <button
      class="icon-btn rounded-full bg-dark-800/70 flex h-10 w-10 items-center justify-center backdrop-blur-sm !text-2xl"
      title="温度图层"
      @click="togglePanel"
    >
      <div :class="isPanelOpen ? 'i-carbon-close' : 'i-carbon-temperature'" />
    </button>

    <!-- 温度图层面板 -->
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
              温湿度图层（850 hPa）
              <span class="text-xs text-gray-400 font-normal ml-1">{{ currentVariable.unit }}</span>
            </h3>
            <!-- 总开关 -->
            <div class="flex items-center justify-between">
              <label class="text-sm">显示图层</label>
              <button
                class="p-1 rounded-full h-6 w-12 transition-colors duration-300"
                :class="timelineStore.showTemp ? 'bg-orange-600' : 'bg-gray-600'"
                @click="timelineStore.showTemp = !timelineStore.showTemp"
              >
                <span
                  class="rounded-full bg-white h-4 w-4 block shadow transform transition-transform duration-300"
                  :class="{ 'translate-x-6': timelineStore.showTemp }"
                />
              </button>
            </div>

            <template v-if="timelineStore.showTemp">
              <!-- 变量切换 -->
              <div class="mt-3 flex gap-1 bg-white/5 p-1 rounded-lg">
                <button
                  v-for="v in TEMP_VARIABLES"
                  :key="v.value"
                  class="flex-1 py-1.5 text-xs rounded-md transition-colors duration-200"
                  :class="timelineStore.tempVariable === v.value
                    ? 'bg-orange-600 text-white font-medium'
                    : 'text-gray-400 hover:text-white'"
                  @click="selectVariable(v.value)"
                >
                  {{ v.label }}
                </button>
              </div>

              <!-- 时间选择 -->
              <div v-if="tempTimeOptions.length > 0" class="mt-3">
                <div class="text-xs text-gray-300 mb-1">
                  时间
                </div>
                <select
                  v-model.number="timelineStore.selectedTempTimestamp"
                  class="text-sm text-white px-2 py-1.5 outline-none border border-gray-600/50 rounded bg-dark-900/80 w-full focus:border-orange-500"
                >
                  <option v-for="opt in tempTimeOptions" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </option>
                </select>
              </div>

              <!-- 透明度 -->
              <div class="mt-3 pt-3 border-t border-gray-500/50">
                <div class="text-xs mb-1 flex justify-between">
                  <span class="text-gray-300">图层透明度</span>
                  <span class="text-gray-400">{{ Math.round(timelineStore.tempOpacity * 100) }}%</span>
                </div>
                <input
                  v-model.number="timelineStore.tempOpacity"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  class="temp-slider"
                >
              </div>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.temp-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.15);
  outline: none;
}

.temp-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #f97316;
  cursor: pointer;
  border: 2px solid rgba(255, 255, 255, 0.3);
}

.temp-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #f97316;
  cursor: pointer;
  border: 2px solid rgba(255, 255, 255, 0.3);
}
</style>
