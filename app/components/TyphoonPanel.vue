<script setup lang="ts">
import type { StormTrack } from '~/composables/timeline'
import { useTimelineStore } from '~/composables/timeline'

const timelineStore = useTimelineStore()
const isPanelOpen = ref(false)

const STORM_COLOR_BY_CODE: Record<string, string> = {
  D: '#94a3b8',
  S: '#22d3ee',
  1: '#84cc16',
  2: '#eab308',
  3: '#f97316',
  4: '#ef4444',
  5: '#a855f7',
  ST: '#dc2626',
}

const STORM_COLOR_BY_SOURCE: Record<string, string> = {
  'zoom-earth': '#00b4d8',
  'cma': '#f87171',
  'jma': '#f4845f',
  'jtwc': '#a3e635',
  'cwa': '#60a5fa',
  'hko': '#fbbf24',
  'kma': '#a78bfa',
}

const SOURCE_LABELS: Record<string, string> = {
  'zoom-earth': 'zoom.earth',
  'cma': 'CMA',
  'jma': 'JMA',
  'jtwc': 'JTWC',
  'cwa': 'CWA',
  'hko': 'HKO',
  'kma': 'KMA',
}

function codeColor(code: string) {
  return STORM_COLOR_BY_CODE[code] ?? '#94a3b8'
}

function sourceColor(source: string) {
  return STORM_COLOR_BY_SOURCE[source] ?? '#94a3b8'
}

function sourceLabel(source: string) {
  return SOURCE_LABELS[source] ?? source
}

// 当前所有 tracks 中出现过的预测 source（用于动态渲染开关列表）
const availableSources = computed(() => {
  const set = new Set<string>()
  for (const track of Object.values(timelineStore.stormTracks)) {
    for (const f of track.forecasts)
      set.add(f.source)
  }
  return [...set].sort()
})

const stormList = computed(() =>
  timelineStore.activeStorms.filter(s => s.kind === 'storm' && s.watched),
)

function trackOf(id: string): StormTrack | undefined {
  return timelineStore.stormTracks[id]
}

function latestPoint(track?: StormTrack) {
  if (!track || !track.track_history.length)
    return undefined
  return [...track.track_history].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  ).at(-1)
}

function codeLabel(code: string) {
  const map: Record<string, string> = {
    D: '热带低压',
    S: '热带风暴',
    1: '强热带风暴',
    2: '台风',
    3: '强台风',
    4: '超强台风',
    5: 'Cat 5',
    ST: '强台风',
  }
  return map[code] ?? code
}

function togglePanel() {
  isPanelOpen.value = !isPanelOpen.value
  if (isPanelOpen.value && timelineStore.activeStorms.length === 0)
    timelineStore.fetchActiveStorms()
}

const fetchedAtLabel = computed(() => {
  if (!timelineStore.stormTracksFetchedAt)
    return ''
  return new Date(timelineStore.stormTracksFetchedAt).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  })
})
</script>

<template>
  <div class="pointer-events-auto right-4 top-52 absolute">
    <!-- 台风图层触发按钮 -->
    <button
      class="icon-btn rounded-full bg-dark-800/70 flex h-10 w-10 items-center justify-center backdrop-blur-sm !text-2xl"
      title="台风路径"
      @click="togglePanel"
    >
      <div :class="isPanelOpen ? 'i-carbon-close' : 'i-carbon-tropical-storm'" />
    </button>

    <!-- 台风图层面板 -->
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
        class="text-white p-4 rounded-lg bg-dark-800/80 w-80 shadow-lg right-12 top-0 absolute backdrop-blur-sm"
      >
        <div class="space-y-3">
          <!-- 标题 + 总开关 -->
          <div>
            <div class="mb-2 pb-2 border-b border-gray-500/50 flex items-center justify-between">
              <h3 class="text-lg font-semibold">
                台风路径
              </h3>
              <button
                class="p-1 rounded-full h-6 w-12 transition-colors duration-300"
                :class="timelineStore.showTyphoon ? 'bg-sky-600' : 'bg-gray-600'"
                @click="timelineStore.showTyphoon = !timelineStore.showTyphoon"
              >
                <span
                  class="rounded-full bg-white h-4 w-4 block shadow transform transition-transform duration-300"
                  :class="{ 'translate-x-6': timelineStore.showTyphoon }"
                />
              </button>
            </div>

            <!-- 刷新按钮 + 上次更新时间 -->
            <div class="text-xs text-gray-400 flex items-center justify-between">
              <button
                class="flex gap-1 transition-colors items-center hover:text-sky-400"
                :disabled="timelineStore.stormTracksLoading"
                @click="timelineStore.refreshStormTracks()"
              >
                <div
                  class="i-carbon-renew"
                  :class="{ 'animate-spin': timelineStore.stormTracksLoading }"
                />
                <span>{{ timelineStore.stormTracksLoading ? '加载中...' : '刷新' }}</span>
              </button>
              <span v-if="fetchedAtLabel">更新于 {{ fetchedAtLabel }}</span>
            </div>
          </div>

          <!-- 台风列表 -->
          <div v-if="stormList.length === 0 && !timelineStore.stormTracksLoading" class="text-sm text-gray-400 py-4 text-center">
            当前无活跃台风
          </div>
          <div v-else class="pr-1 max-h-80 overflow-y-auto space-y-2">
            <div
              v-for="storm in stormList"
              :key="storm.id"
              class="p-2 rounded bg-dark-900/40 transition-colors hover:bg-dark-900/60"
            >
              <div class="flex gap-2 items-center justify-between">
                <div class="flex gap-2 min-w-0 items-center">
                  <span
                    class="rounded-full shrink-0 h-3 w-3 shadow"
                    :style="{ backgroundColor: codeColor(latestPoint(trackOf(storm.id))?.code ?? 'D') }"
                  />
                  <div class="min-w-0">
                    <div class="text-sm font-medium truncate">
                      {{ trackOf(storm.id)?.info.name ?? storm.id }}
                    </div>
                    <div class="text-xs text-gray-400 truncate">
                      <span v-if="latestPoint(trackOf(storm.id))">
                        {{ codeLabel(latestPoint(trackOf(storm.id))?.code ?? 'D') }}
                        · {{ latestPoint(trackOf(storm.id))?.wind }} kt
                      </span>
                      <span v-else>加载中...</span>
                    </div>
                  </div>
                </div>
                <div class="flex shrink-0 gap-1 items-center">
                  <span
                    v-if="trackOf(storm.id)?.info.active"
                    class="rounded-full bg-green-500 h-2 w-2"
                    title="活跃中"
                  />
                  <button
                    class="p-0.5 rounded-full h-5 w-9 transition-colors duration-300"
                    :class="(timelineStore.stormVisibility[storm.id] ?? true) ? 'bg-sky-600' : 'bg-gray-600'"
                    @click="timelineStore.stormVisibility[storm.id] = !(timelineStore.stormVisibility[storm.id] ?? true)"
                  >
                    <span
                      class="rounded-full bg-white h-3 w-3 block shadow transform transition-transform duration-300"
                      :class="{ 'translate-x-4': timelineStore.stormVisibility[storm.id] ?? true }"
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- 图例 -->
          <div class="text-xs text-gray-400 pt-2 border-t border-gray-500/50 space-y-1">
            <div class="flex gap-2 items-center">
              <span class="bg-amber-400 h-0.5 w-6 inline-block" />
              <span>实况路径</span>
            </div>
            <div class="flex gap-2 items-center">
              <span class="border-t border-sky-400 border-dashed h-0.5 w-6 inline-block" />
              <span>多源预测（虚线）</span>
            </div>
          </div>

          <!-- 预测机构开关 -->
          <div v-if="availableSources.length > 0" class="pt-2 border-t border-gray-500/50 space-y-1.5">
            <div class="text-xs text-gray-400 font-semibold">
              预测机构
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="source in availableSources"
                :key="source"
                class="text-xs px-2 py-1 border rounded flex gap-1.5 transition-colors duration-200 items-center"
                :class="(timelineStore.stormForecastSources[source] ?? false)
                  ? 'border-transparent text-white'
                  : 'border-gray-600/50 text-gray-400 hover:text-gray-200'"
                :style="(timelineStore.stormForecastSources[source] ?? false)
                  ? { backgroundColor: sourceColor(source) }
                  : {}"
                :title="sourceLabel(source)"
                @click="timelineStore.stormForecastSources[source] = !(timelineStore.stormForecastSources[source] ?? false)"
              >
                <span
                  class="rounded-full h-2 w-2"
                  :style="{ backgroundColor: sourceColor(source) }"
                />
                <span>{{ sourceLabel(source) }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
