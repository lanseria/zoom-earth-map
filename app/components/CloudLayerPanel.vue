<script setup lang="ts">
import type { CloudType, CloudVariable } from '~/composables/timeline'
import { useTimelineStore } from '~/composables/timeline'

const timelineStore = useTimelineStore()
const isPanelOpen = ref(false)

const CLOUD_TYPES: { value: CloudType, label: string, desc: string }[] = [
  { value: 'tcdc', label: '总云量', desc: '全层云覆盖' },
  { value: 'lcdc', label: '低云量', desc: '低层云' },
  { value: 'mcdc', label: '中云量', desc: '中层云' },
  { value: 'hcdc', label: '高云量', desc: '高层云' },
]

const CLOUD_VARIABLES: { value: CloudVariable, label: string, unit: string }[] = [
  { value: 'cloud', label: '云量', unit: '%' },
  { value: 'vis', label: '能见度', unit: 'km' },
]

const currentCloudVariable = computed(() =>
  CLOUD_VARIABLES.find(v => v.value === timelineStore.cloudVariable) ?? CLOUD_VARIABLES[0]!,
)

async function selectCloudVariable(v: CloudVariable) {
  if (timelineStore.cloudVariable === v)
    return
  timelineStore.cloudVariable = v
  timelineStore.resetCloudManifests()
  if (timelineStore.showCloud)
    await timelineStore.fetchCloudManifests()
}

function formatCloudTime(ts: number) {
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  })
}

const cloudTimeOptions = computed(() =>
  timelineStore.cloudTimestamps.map(ts => ({ value: ts, label: formatCloudTime(ts) })),
)

async function togglePanel() {
  isPanelOpen.value = !isPanelOpen.value
  if (isPanelOpen.value && timelineStore.cloudTimestamps.length === 0)
    await timelineStore.fetchCloudManifests()
}
</script>

<template>
  <div class="pointer-events-auto right-4 top-64 absolute">
    <!-- 云量图层触发按钮 -->
    <button
      class="icon-btn rounded-full bg-dark-800/70 flex h-10 w-10 items-center justify-center backdrop-blur-sm !text-2xl"
      title="云量图层"
      @click="togglePanel"
    >
      <div :class="isPanelOpen ? 'i-carbon-close' : 'i-carbon-cloud'" />
    </button>

    <!-- 云量图层面板 -->
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
              {{ currentCloudVariable.label }}图层
              <span class="text-xs text-gray-400 font-normal ml-1">{{ currentCloudVariable.unit }}</span>
            </h3>
            <!-- 总开关 -->
            <div class="flex items-center justify-between">
              <label class="text-sm">显示图层</label>
              <button
                class="p-1 rounded-full h-6 w-12 transition-colors duration-300"
                :class="timelineStore.showCloud ? 'bg-sky-600' : 'bg-gray-600'"
                @click="timelineStore.showCloud = !timelineStore.showCloud"
              >
                <span
                  class="rounded-full bg-white h-4 w-4 block shadow transform transition-transform duration-300"
                  :class="{ 'translate-x-6': timelineStore.showCloud }"
                />
              </button>
            </div>

            <template v-if="timelineStore.showCloud">
              <!-- 变量切换 -->
              <div class="mt-3 flex gap-1 bg-white/5 p-1 rounded-lg">
                <button
                  v-for="v in CLOUD_VARIABLES"
                  :key="v.value"
                  class="flex-1 py-1.5 text-xs rounded-md transition-colors duration-200"
                  :class="timelineStore.cloudVariable === v.value
                    ? 'bg-sky-600 text-white font-medium'
                    : 'text-gray-400 hover:text-white'"
                  @click="selectCloudVariable(v.value)"
                >
                  {{ v.label }}
                </button>
              </div>

              <!-- 云量类型选择 -->
              <div v-if="timelineStore.cloudVariable === 'cloud'" class="mt-3">
                <div class="text-xs text-gray-300 mb-1.5">
                  云量类型
                </div>
                <div class="gap-1 grid grid-cols-2">
                  <button
                    v-for="t in CLOUD_TYPES"
                    :key="t.value"
                    class="px-2 py-1.5 rounded flex flex-col transition-colors duration-200 items-center"
                    :class="timelineStore.cloudType === t.value
                      ? 'bg-sky-600 text-white'
                      : 'bg-white/10 text-gray-400 hover:bg-white/20'"
                    :title="t.desc"
                    @click="timelineStore.cloudType = t.value"
                  >
                    <span class="text-xs font-medium">{{ t.label }}</span>
                    <span class="text-[10px] mt-0.5 opacity-70">{{ t.desc }}</span>
                  </button>
                </div>
              </div>

              <!-- 时间选择 -->
              <div v-if="cloudTimeOptions.length > 0" class="mt-3">
                <div class="text-xs text-gray-300 mb-1">
                  时间
                </div>
                <select
                  v-model.number="timelineStore.selectedCloudTimestamp"
                  class="text-sm text-white px-2 py-1.5 outline-none border border-gray-600/50 rounded bg-dark-900/80 w-full focus:border-sky-500"
                >
                  <option v-for="opt in cloudTimeOptions" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </option>
                </select>
              </div>

              <!-- 透明度 -->
              <div class="mt-3 pt-3 border-t border-gray-500/50">
                <div class="text-xs mb-1 flex justify-between">
                  <span class="text-gray-300">图层透明度</span>
                  <span class="text-gray-400">{{ Math.round(timelineStore.cloudOpacity * 100) }}%</span>
                </div>
                <input
                  v-model.number="timelineStore.cloudOpacity"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  class="cloud-slider"
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
.cloud-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.15);
  outline: none;
}

.cloud-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #38bdf8;
  cursor: pointer;
  border: 2px solid rgba(255, 255, 255, 0.3);
}

.cloud-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #38bdf8;
  cursor: pointer;
  border: 2px solid rgba(255, 255, 255, 0.3);
}
</style>
