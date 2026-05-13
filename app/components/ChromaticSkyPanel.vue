<script setup lang="ts">
import type { ChromaticSkyResource } from '~/composables/timeline'
import { useTimelineStore } from '~/composables/timeline'

const timelineStore = useTimelineStore()
const isPanelOpen = ref(false)

// 可用日期集合
const availableDates = computed(() => {
  const set = new Set<string>()
  for (const r of timelineStore.chromaticSkyManifest)
    set.add(r.date)
  return set
})

// 某日期可用的 event 列表
function getEventsForDate(date: string): string[] {
  return timelineStore.chromaticSkyManifest
    .filter(r => r.date === date)
    .map(r => r.event)
    .sort()
}

// --- 日历 ---
const now = new Date()
const viewYear = ref(now.getFullYear())
const viewMonth = ref(now.getMonth()) // 0-indexed

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

const calendarDays = computed(() => {
  const y = viewYear.value
  const m = viewMonth.value
  // 该月第一天是星期几（0=日，调整为周一起始）
  const firstDay = new Date(y, m, 1).getDay()
  const offset = firstDay === 0 ? 6 : firstDay - 1
  // 该月天数
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const days: { day: number, dateStr: string, available: boolean }[] = []
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}${String(m + 1).padStart(2, '0')}${String(d).padStart(2, '0')}`
    days.push({ day: d, dateStr, available: availableDates.value.has(dateStr) })
  }
  return { offset, days }
})

const viewMonthLabel = computed(() => `${viewYear.value}年${viewMonth.value + 1}月`)

function prevMonth() {
  if (viewMonth.value === 0) {
    viewMonth.value = 11
    viewYear.value--
  }
  else {
    viewMonth.value--
  }
}

function nextMonth() {
  if (viewMonth.value === 11) {
    viewMonth.value = 0
    viewYear.value++
  }
  else {
    viewMonth.value++
  }
}

// --- 选中状态 ---
const selectedDate = computed(() => timelineStore.chromaticSkySelection?.date ?? '')
const selectedEvent = computed(() => timelineStore.chromaticSkySelection?.event ?? '')

function selectDay(dateStr: string) {
  if (!availableDates.value.has(dateStr))
    return
  const events = getEventsForDate(dateStr)
  // 如果点击已选日期，取消选择
  if (dateStr === selectedDate.value) {
    timelineStore.setChromaticSkySelection(null)
    return
  }
  // 选该日期第一个可用 event
  timelineStore.setChromaticSkySelection({ date: dateStr, event: events[0]! })
}

function selectEvent(event: string) {
  if (!selectedDate.value)
    return
  timelineStore.setChromaticSkySelection({ date: selectedDate.value, event })
}

function eventLabel(event: string) {
  return event === 'sunrise' ? '日出' : '日落'
}

function togglePanel() {
  isPanelOpen.value = !isPanelOpen.value
  if (isPanelOpen.value && timelineStore.chromaticSkyManifest.length === 0)
    timelineStore.fetchChromaticSkyManifest()
}
</script>

<template>
  <div class="pointer-events-auto right-4 top-28 absolute">
    <!-- 火烧云触发按钮 -->
    <button
      class="icon-btn rounded-full bg-dark-800/70 flex h-10 w-10 items-center justify-center backdrop-blur-sm !text-2xl"
      title="火烧云指数"
      @click="togglePanel"
    >
      <div :class="isPanelOpen ? 'i-carbon-close' : 'i-carbon-sun'" />
    </button>

    <!-- 火烧云面板 -->
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
              火烧云指数
            </h3>
            <!-- 显示开关 -->
            <div class="flex items-center justify-between mt-2">
              <label class="text-sm">显示图层</label>
              <button
                class="p-1 rounded-full h-6 w-12 transition-colors duration-300"
                :class="timelineStore.showChromaticSky ? 'bg-sky-600' : 'bg-gray-600'"
                @click="timelineStore.showChromaticSky = !timelineStore.showChromaticSky"
              >
                <span
                  class="rounded-full bg-white h-4 w-4 block shadow transform transition-transform duration-300"
                  :class="{ 'translate-x-6': timelineStore.showChromaticSky }"
                />
              </button>
            </div>

            <!-- 月份导航 -->
            <div class="flex items-center justify-between mt-2">
              <button class="p-1 hover:bg-gray-600/50 rounded" @click="prevMonth">
                <div class="i-carbon-chevron-left text-lg" />
              </button>
              <span class="text-sm font-medium">{{ viewMonthLabel }}</span>
              <button class="p-1 hover:bg-gray-600/50 rounded" @click="nextMonth">
                <div class="i-carbon-chevron-right text-lg" />
              </button>
            </div>

            <!-- 星期标题 -->
            <div class="grid grid-cols-7 mt-2">
              <div v-for="w in WEEKDAYS" :key="w" class="text-center text-xs text-gray-400 py-1">
                {{ w }}
              </div>
            </div>

            <!-- 日期网格 -->
            <div class="grid grid-cols-7 mt-1">
              <!-- 占位 -->
              <div
                v-for="i in calendarDays.offset"
                :key="`e-${i}`"
                class="h-8"
              />
              <button
                v-for="d in calendarDays.days"
                :key="d.dateStr"
                class="h-8 w-8 mx-auto flex items-center justify-center text-sm rounded transition-colors duration-200"
                :class="{
                  'bg-orange-600 text-white font-bold': d.dateStr === selectedDate,
                  'text-white hover:bg-gray-600/50 cursor-pointer': d.available && d.dateStr !== selectedDate,
                  'text-gray-600 cursor-default': !d.available,
                }"
                :disabled="!d.available"
                @click="selectDay(d.dateStr)"
              >
                {{ d.day }}
              </button>
            </div>

            <!-- 日出/日落选择 -->
            <div v-if="selectedDate" class="flex gap-2 mt-3">
              <button
                v-for="ev in getEventsForDate(selectedDate)"
                :key="ev"
                class="text-sm px-4 py-1.5 rounded transition-colors duration-200 flex-1"
                :class="ev === selectedEvent ? 'bg-orange-600 text-white' : 'bg-dark-900/50 hover:bg-gray-600/50'"
                @click="selectEvent(ev)"
              >
                {{ eventLabel(ev) }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
