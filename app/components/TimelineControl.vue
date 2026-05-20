<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useTimelineStore } from '~/composables/timeline'

const timelineStore = useTimelineStore()

// --- Ruler 控制逻辑 ---
const virtualTime = ref(0)
const isDragging = ref(false)
const isWheeling = ref(false)
const PX_PER_SECOND = 1 / 30 // 1像素 = 30秒
const rulerWidth = 224 // 宽 56 (w-56 = 224px)

// 监听真实时间，非拖拽时同步
watch(() => timelineStore.selectedTimestamp, (newTs) => {
  if (!isDragging.value && !isWheeling.value && newTs) {
    virtualTime.value = newTs
  }
}, { immediate: true })

// 拖拽相关
let startX = 0
let startVirtualTime = 0

// 刻度计算

function onPointerDown(e: PointerEvent) {
  if (!timelineStore.timestamps.length)
    return
  isDragging.value = true
  startX = e.clientX
  startVirtualTime = virtualTime.value
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (!isDragging.value)
    return
  const deltaX = e.clientX - startX
  const deltaSeconds = -deltaX / PX_PER_SECOND
  virtualTime.value = startVirtualTime + deltaSeconds

  // 边界约束
  const minTs = timelineStore.timestamps[0]
  if (minTs === undefined)
    return
  const maxTs = timelineStore.timestamps[timelineStore.timestamps.length - 1]!
  if (virtualTime.value < minTs)
    virtualTime.value = minTs
  if (virtualTime.value > maxTs)
    virtualTime.value = maxTs

  // 同步更新最近的 timestamp
  const closestIndex = timelineStore.findClosestTimestampIndex(virtualTime.value)
  if (closestIndex !== -1 && closestIndex !== timelineStore.currentTimestampIndex) {
    timelineStore.currentTimestampIndex = closestIndex
  }
}

function onPointerUp(e: PointerEvent) {
  if (!isDragging.value)
    return
  isDragging.value = false
  ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)

  // 松开后吸附到真实的 selectedTimestamp
  if (timelineStore.selectedTimestamp) {
    virtualTime.value = timelineStore.selectedTimestamp
  }
}

let wheelTimer: ReturnType<typeof setTimeout> | null = null

function onWheel(e: WheelEvent) {
  if (!timelineStore.timestamps.length)
    return
  isWheeling.value = true

  // 优先使用水平滚动差值，如果不支持水平则使用垂直滚动差值
  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
  const deltaSeconds = delta / PX_PER_SECOND * 0.5

  virtualTime.value += deltaSeconds

  // 边界约束
  const minTs = timelineStore.timestamps[0]
  if (minTs === undefined)
    return
  const maxTs = timelineStore.timestamps[timelineStore.timestamps.length - 1]!
  if (virtualTime.value < minTs)
    virtualTime.value = minTs
  if (virtualTime.value > maxTs)
    virtualTime.value = maxTs

  // 同步更新最近的 timestamp
  const closestIndex = timelineStore.findClosestTimestampIndex(virtualTime.value)
  if (closestIndex !== -1 && closestIndex !== timelineStore.currentTimestampIndex) {
    timelineStore.currentTimestampIndex = closestIndex
  }

  if (wheelTimer)
    clearTimeout(wheelTimer)
  wheelTimer = setTimeout(() => {
    isWheeling.value = false
    if (timelineStore.selectedTimestamp) {
      virtualTime.value = timelineStore.selectedTimestamp
    }
  }, 300)
}

// 刻度计算
const windMarkers = computed(() => {
  if (!timelineStore.showWind || !virtualTime.value)
    return []
  const windTs = timelineStore.getAvailableWindTimestamps(timelineStore.selectedWindLevel)
  const halfSpan = (rulerWidth / 2) / PX_PER_SECOND
  const start = virtualTime.value - halfSpan
  const end = virtualTime.value + halfSpan
  return windTs
    .filter(ts => ts >= start && ts <= end)
    .map((ts) => {
      const x = (ts - virtualTime.value) * PX_PER_SECOND
      return { ts, x }
    })
})

function onWindMarkerClick(ts: number) {
  timelineStore.jumpToTimestamp(ts)
}

const ticks = computed(() => {
  if (!virtualTime.value)
    return []
  const halfSpan = (rulerWidth / 2) / PX_PER_SECOND
  const start = virtualTime.value - halfSpan
  const end = virtualTime.value + halfSpan

  // 每10分钟(600秒)一个刻度
  const firstTick = Math.ceil(start / 600) * 600
  const lastTick = Math.floor(end / 600) * 600

  const res = []
  for (let t = firstTick; t <= lastTick; t += 600) {
    const d = new Date(t * 1000)
    const isDay = d.getHours() === 0 && d.getMinutes() === 0
    const isHour = d.getMinutes() === 0
    const x = (t - virtualTime.value) * PX_PER_SECOND

    res.push({
      time: t,
      x,
      type: isDay ? 'day' : (isHour ? 'hour' : 'minute'),
      label: isDay ? `${d.getMonth() + 1}/${d.getDate()}` : (isHour ? `${d.getHours().toString().padStart(2, '0')}:00` : ''),
    })
  }
  return res
})
</script>

<template>
  <div
    class="text-white p-3 rounded-lg bg-dark-800/70 flex gap-4 pointer-events-auto shadow-lg items-center bottom-8 left-1/2 justify-center absolute backdrop-blur-1 -translate-x-1/2"
  >
    <!-- 播放/暂停按钮 -->
    <button
      class="icon-btn !text-3xl"
      :disabled="timelineStore.isFirstTimestamp && timelineStore.isLastTimestamp"
      @click="timelineStore.togglePlay"
    >
      <div :class="timelineStore.isPlaying ? 'i-carbon-pause-filled' : 'i-carbon-play-filled-alt'" />
    </button>

    <!-- 中间控制区域：根据 controlStyle 切换 -->
    <template v-if="timelineStore.controlStyle === 'classic'">
      <!-- 经典日期和时间选择器 -->
      <div class="text-center flex gap-4 items-center">
        <!-- 日期调整 -->
        <div class="flex flex-col w-32 items-center">
          <button class="icon-btn" :disabled="timelineStore.isPlaying || !timelineStore.hasNextDay" title="后一天" @click="timelineStore.nextDay">
            <div i-carbon-chevron-up />
          </button>
          <div class="text-lg font-mono tabular-nums">
            {{ timelineStore.formattedDate }}
          </div>
          <button class="icon-btn" :disabled="timelineStore.isPlaying || !timelineStore.hasPrevDay" title="前一天" @click="timelineStore.prevDay">
            <div i-carbon-chevron-down />
          </button>
        </div>
        <!-- 时间调整 -->
        <div class="flex flex-col w-20 items-center">
          <button class="icon-btn" :disabled="timelineStore.isPlaying || timelineStore.isLastTimestamp" title="下一个时间点" @click="timelineStore.nextTimestamp">
            <div i-carbon-chevron-up />
          </button>
          <div class="text-xl font-mono tabular-nums">
            {{ timelineStore.formattedTime }}
          </div>
          <button class="icon-btn" :disabled="timelineStore.isPlaying || timelineStore.isFirstTimestamp" title="上一个时间点" @click="timelineStore.prevTimestamp">
            <div i-carbon-chevron-down />
          </button>
        </div>
      </div>
    </template>
    <template v-else>
      <!-- 刻度尺时间选择器 -->
      <div class="flex flex-col w-56 items-center">
        <!-- 当前时间显示 -->
        <div class="text-sm text-sky-400 font-bold font-mono mb-1 tabular-nums">
          {{ timelineStore.formattedDate }} {{ timelineStore.formattedTime }}
        </div>
        <!-- Ruler 区域 -->
        <div
          class="rounded-md bg-dark-900/50 h-12 w-full cursor-grab select-none relative overflow-hidden touch-none"
          :class="{ 'cursor-grabbing': isDragging }"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @wheel.prevent="onWheel"
        >
          <!-- 游标 -->
          <div class="bg-sky-500 opacity-80 h-full w-0.5 pointer-events-none left-1/2 top-0 absolute z-10 -translate-x-1/2" />

          <!-- 刻度容器 -->
          <div class="pointer-events-none bottom-0 left-1/2 top-0 absolute">
            <div
              v-for="tick in ticks" :key="tick.time"
              class="flex flex-col items-center bottom-0 absolute"
              :style="{ transform: `translateX(${tick.x}px)` }"
            >
              <div v-if="tick.label" class="text-[10px] text-gray-400 mb-0.5 whitespace-nowrap bottom-full left-1/2 absolute -translate-x-1/2">
                {{ tick.label }}
              </div>
              <div
                class="w-px"
                :class="{
                  'h-6 bg-gray-300': tick.type === 'day',
                  'h-4 bg-gray-400': tick.type === 'hour',
                  'h-2 bg-gray-600': tick.type === 'minute',
                }"
              />
            </div>
            <!-- 风力时间标记 -->
            <div
              v-for="marker in windMarkers" :key="`wind-${marker.ts}`"
              class="bottom-0 left-1/2 absolute pointer-events-auto cursor-pointer z-20"
              :style="{ transform: `translateX(${marker.x}px)` }"
              @pointerdown.stop="onWindMarkerClick(marker.ts)"
            >
              <div
                class="w-1.5 rounded-full"
                :class="timelineStore.currentWindTimestamp === marker.ts ? 'bg-sky-400 h-3' : 'bg-emerald-400/80 h-2'"
              />
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 跳转到最新时间点按钮 -->
    <button
      class="icon-btn !text-xl"
      title="跳转到最新"
      :disabled="timelineStore.isLastTimestamp || timelineStore.isPlaying"
      @click="timelineStore.goToLatest"
    >
      <div i-carbon-skip-forward-filled />
    </button>
  </div>
</template>
