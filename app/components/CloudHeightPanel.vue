<script setup lang="ts">
import type { FeatureCollection } from 'geojson'
import type { GeoJSONSource, Map, MapMouseEvent } from 'maplibre-gl'
import * as maplibregl from 'maplibre-gl'
import { useTimelineStore } from '~/composables/timeline'
import { computeCloudHeight } from '~/utils/cloudHeight'

const timelineStore = useTimelineStore()

const isPanelOpen = ref(false)
const isMeasuring = ref(false)
const step = ref<'idle' | 'pick-a' | 'pick-b' | 'done'>('idle')
const pointA = ref<{ lat: number, lng: number } | null>(null)
const pointB = ref<{ lat: number, lng: number } | null>(null)
// 测量完成时锁定的影像时间（时间轴后续拖动不影响已出结果）
const measuredTimestamp = ref<number | null>(null)

const LINE_SOURCE_ID = 'cloud-height-line-source'
const LINE_LAYER_ID = 'cloud-height-line-layer'
let markerA: maplibregl.Marker | null = null
let markerB: maplibregl.Marker | null = null

function getMap(): Map | null {
  return timelineStore.mapViewerInstance?.getMapInstance() ?? null
}

// --- 结果计算 ---
/** 当前视图下瓦片金字塔的有效地面分辨率（米/像素）；瓦片源 maxzoom=7，再放大只是拉伸 */
function tileResolutionM(lat: number): number {
  const zoom = Math.min(getMap()?.getZoom() ?? 5, 7)
  return 40075016.686 * Math.cos(lat * Math.PI / 180) / (256 * 2 ** zoom)
}

const result = computed(() => {
  if (!pointA.value || !pointB.value || measuredTimestamp.value == null)
    return null
  return computeCloudHeight({
    time: new Date(measuredTimestamp.value * 1000),
    cloudTop: pointA.value,
    shadow: pointB.value,
    resolutionM: tileResolutionM(pointB.value.lat),
  })
})

const himawariHidden = computed(() =>
  !timelineStore.showSatelliteCloud || !timelineStore.satelliteVisibility.himawari,
)

const displayWarnings = computed(() => {
  const list = result.value?.valid ? [...result.value.warnings] : []
  if (himawariHidden.value)
    list.unshift('Himawari-8 云图图层当前处于隐藏状态，请先在卫星图层面板中开启')
  return list
})

const methodLabel = computed(() => {
  if (!result.value?.valid)
    return ''
  return result.value.method === 'ray-trace' ? '光线追踪·曲率修正' : '平面矢量·视差修正'
})

const timeLabel = computed(() => {
  if (measuredTimestamp.value == null)
    return '--'
  const d = new Date(measuredTimestamp.value * 1000)
  const utc = d.toISOString().slice(0, 16).replace('T', ' ')
  const bj = d.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${utc} UTC（北京 ${bj}）`
})

const coordLabel = computed(() => {
  const f = (p: { lat: number, lng: number }) =>
    `${Math.abs(p.lat).toFixed(2)}°${p.lat >= 0 ? 'N' : 'S'} ${Math.abs(p.lng).toFixed(2)}°${p.lng >= 0 ? 'E' : 'W'}`
  return [
    pointA.value ? `A ${f(pointA.value)}` : '',
    pointB.value ? `B ${f(pointB.value)}` : '',
  ].filter(Boolean).join(' · ')
})

const fmtKm = (m: number) => `${(m / 1000).toFixed(2)} km`
const fmtDeg = (d: number) => `${d.toFixed(1)}°`

// --- 地图交互 ---
function onMapClick(e: MapMouseEvent) {
  const { lat, lng } = e.lngLat
  if (step.value === 'pick-a') {
    pointA.value = { lat, lng }
    addMarker('a', lat, lng)
    step.value = 'pick-b'
  }
  else if (step.value === 'pick-b') {
    pointB.value = { lat, lng }
    addMarker('b', lat, lng)
    drawMeasureLine()
    measuredTimestamp.value = timelineStore.selectedTimestamp ?? null
    step.value = 'done'
    stopCapture()
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape')
    cancelMeasuring()
}

function beginCapture(): boolean {
  const map = getMap()
  if (!map)
    return false
  isMeasuring.value = true
  map.getCanvas().style.cursor = 'crosshair'
  map.on('click', onMapClick)
  window.addEventListener('keydown', onKeydown)
  return true
}

function stopCapture() {
  const map = getMap()
  if (map) {
    map.off('click', onMapClick)
    map.getCanvas().style.cursor = ''
  }
  window.removeEventListener('keydown', onKeydown)
  isMeasuring.value = false
}

function startMeasuring() {
  clearAll()
  if (!beginCapture())
    return
  step.value = 'pick-a'
}

function resumeCapture() {
  beginCapture()
}

function cancelMeasuring() {
  stopCapture()
  if (!pointA.value && !pointB.value)
    step.value = 'idle'
}

/** 已选 A 点后重选：仅清除 A，继续处于拾取状态 */
function restartFromA() {
  markerA?.remove()
  markerA = null
  pointA.value = null
  step.value = 'pick-a'
}

function addMarker(kind: 'a' | 'b', lat: number, lng: number) {
  const map = getMap()
  if (!map)
    return
  const el = document.createElement('div')
  el.className = 'cloud-height-marker'
  el.textContent = kind.toUpperCase()
  el.style.background = kind === 'a' ? '#38bdf8' : '#facc15'
  const marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map)
  if (kind === 'a')
    markerA = marker
  else
    markerB = marker
}

function drawMeasureLine() {
  const map = getMap()
  if (!map || !pointA.value || !pointB.value)
    return
  const data: FeatureCollection = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [pointA.value.lng, pointA.value.lat],
          [pointB.value.lng, pointB.value.lat],
        ],
      },
    }],
  }
  if (!map.getSource(LINE_SOURCE_ID)) {
    map.addSource(LINE_SOURCE_ID, { type: 'geojson', data })
    map.addLayer({
      id: LINE_LAYER_ID,
      type: 'line',
      source: LINE_SOURCE_ID,
      paint: {
        'line-color': '#facc15',
        'line-width': 2,
        'line-dasharray': [2, 1],
      },
    })
  }
  else {
    (map.getSource(LINE_SOURCE_ID) as GeoJSONSource).setData(data)
  }
}

function removeMeasureGraphics() {
  markerA?.remove()
  markerA = null
  markerB?.remove()
  markerB = null
  const map = getMap()
  if (map) {
    try {
      if (map.getLayer(LINE_LAYER_ID))
        map.removeLayer(LINE_LAYER_ID)
      if (map.getSource(LINE_SOURCE_ID))
        map.removeSource(LINE_SOURCE_ID)
    }
    catch {
      // 地图实例可能已随页面销毁，忽略
    }
  }
}

function clearAll() {
  stopCapture()
  removeMeasureGraphics()
  pointA.value = null
  pointB.value = null
  measuredTimestamp.value = null
  step.value = 'idle'
}

function togglePanel() {
  isPanelOpen.value = !isPanelOpen.value
  if (!isPanelOpen.value)
    clearAll()
}

onUnmounted(clearAll)
</script>

<template>
  <div class="pointer-events-auto right-4 top-88 absolute">
    <!-- 触发按钮 -->
    <button
      class="icon-btn rounded-full bg-dark-800/70 flex h-10 w-10 items-center justify-center backdrop-blur-sm !text-2xl"
      title="云顶高度测量"
      @click="togglePanel"
    >
      <div :class="isPanelOpen ? 'i-carbon-close' : 'i-carbon-ruler'" />
    </button>

    <!-- 测量面板 -->
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
        <h3 class="text-lg font-semibold mb-2 pb-1 border-b border-gray-500/50">
          云顶高度测量
          <span class="text-xs text-gray-400 font-normal ml-1">云影反演 · 视差修正</span>
        </h3>

        <!-- 选点操作区 -->
        <div v-if="step !== 'done'" class="space-y-2">
          <p class="text-xs text-gray-300 leading-5">
            在云图上点选<b class="text-sky-400">云顶视位置（A）</b>与对应的<b class="text-yellow-400">云影中心（B）</b>，
            结合当前时间轴时刻的太阳与卫星几何反演云顶高度。仅支持 Himawari-8 覆盖区。
          </p>
          <div v-if="isMeasuring" class="px-3 py-2 rounded bg-dark-900/60">
            <p class="text-xs">
              <span v-if="step === 'pick-a'" class="text-sky-400">① 点击云朵边缘（云顶视位置 A）</span>
              <span v-else class="text-yellow-400">② 点击地面/低云上的阴影中心（B）</span>
            </p>
            <div class="mt-1 flex items-center justify-between">
              <span class="text-[10px] text-gray-500">按 Esc 取消</span>
              <button
                v-if="step === 'pick-b'"
                class="text-[10px] text-gray-400 underline hover:text-white"
                @click="restartFromA"
              >
                重选 A 点
              </button>
            </div>
          </div>
          <template v-if="!isMeasuring">
            <button
              class="text-sm btn w-full"
              @click="step === 'pick-b' ? resumeCapture() : startMeasuring()"
            >
              {{ step === 'pick-b' ? '继续选点' : '开始测量' }}
            </button>
          </template>
          <button v-else class="text-sm btn w-full" @click="cancelMeasuring">
            取消
          </button>
        </div>

        <!-- 结果区 -->
        <template v-else>
          <div
            v-if="!result || !result.valid"
            class="text-xs text-red-300 px-3 py-2 border border-red-500/40 rounded bg-red-900/40 flex gap-1.5 items-start"
          >
            <span class="i-carbon-warning-alt mt-0.5 shrink-0" />
            <span>{{ result?.rejection ?? '测量失败：缺少影像时间数据' }}</span>
          </div>
          <div v-else>
            <div class="flex items-end justify-between">
              <div>
                <div class="text-xs text-gray-400">
                  云顶高度（视差已修正）
                </div>
                <div class="text-3xl text-sky-400 leading-tight font-semibold">
                  {{ ((result.heightM ?? 0) / 1000).toFixed(2) }}<span class="text-sm text-gray-300 ml-1">km</span>
                </div>
              </div>
              <span class="text-[10px] px-1.5 py-0.5 rounded bg-sky-600/70 inline-block whitespace-nowrap">{{ methodLabel }}</span>
            </div>
            <div class="text-xs mt-3 gap-x-3 gap-y-1 grid grid-cols-2">
              <div class="flex justify-between">
                <span class="text-gray-400">ΔL 位移</span><span>{{ fmtKm(result.deltaLM) }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-400">识别阈值</span><span>{{ fmtKm(result.thresholdM) }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-400">太阳天顶角 α</span><span>{{ fmtDeg(result.solarZenithDeg) }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-400">太阳方位角</span><span>{{ fmtDeg(result.solarAzimuthDeg) }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-400">卫星天顶角 β</span><span>{{ fmtDeg(result.satZenithDeg) }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-400">卫星方位角</span><span>{{ fmtDeg(result.satAzimuthDeg) }}</span>
              </div>
            </div>
            <div class="text-[10px] text-gray-500 mt-2">
              影像时间：{{ timeLabel }}
            </div>
            <div class="text-[10px] text-gray-500 mt-1">
              {{ coordLabel }}
            </div>
            <!-- 质量控制 -->
            <div class="mt-3 pt-2 border-t border-gray-500/50 space-y-1">
              <p v-if="displayWarnings.length === 0" class="text-xs text-green-400 flex gap-1 items-center">
                <span class="i-carbon-checkmark" /> 质量检查通过
              </p>
              <p v-for="(w, i) in displayWarnings" :key="i" class="text-[11px] text-yellow-400 flex gap-1 items-start">
                <span class="i-carbon-warning-alt mt-0.5 shrink-0" />{{ w }}
              </p>
            </div>
            <p class="text-[10px] text-gray-500 leading-4 mt-2">
              云影默认位于海平面（未接入 DEM）；建议在太阳天顶角 30°~80°、卫星天顶角 &lt; 60° 时测量。
            </p>
          </div>
          <div class="mt-3 flex gap-2">
            <button class="text-sm btn flex-1" @click="startMeasuring">
              重新测量
            </button>
            <button class="text-sm btn flex-1" @click="clearAll">
              清除
            </button>
          </div>
        </template>
      </div>
    </Transition>
  </div>
</template>

<style>
/* 测量标记（挂在 maplibre 容器下，需全局样式） */
.cloud-height-marker {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.9);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.6);
  cursor: default;
  user-select: none;
}
</style>
