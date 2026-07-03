// app/composables/timeline.ts

import type MapViewer from '~/components/MapViewer.vue'
import type { BaseMapType } from '~/constants/map'
import { acceptHMRUpdate, defineStore } from 'pinia'
import { MAP_STYLE_OPTIONS, SATELLITES } from '~/constants/map'

// --- 类型定义 ---
// --- 地图投影类型 ---
export type MapProjection = 'mercator' | 'globe'

export type AnimationSpeed = 'slow' | 'medium' | 'fast'
export type AnimationDuration = 3 | 6 | 12 | 24
export type AnimationStyle = 'fast' | 'smooth'
export type TimelineControlStyle = 'classic' | 'ruler'

export interface ChromaticSkyResource { date: string, event: string }

// --- 大气图层类型 ---
// 温度/湿度变量 token
export type TempVariable = 'temp' | 'rh'
// 云量类型 token：总/低/中/高 云量
export type CloudType = 'tcdc' | 'lcdc' | 'mcdc' | 'hcdc'
// 云量/能见度变量 token
export type CloudVariable = 'cloud' | 'vis'

// --- 台风相关类型 ---
export type StormCode = 'D' | 'S' | '1' | '2' | '3' | '4' | '5' | 'ST' | string

export interface StormActiveItem {
  id: string
  kind: 'storm' | 'disturbance'
  watched: boolean
  sources: string[]
  cma_tfid: string | null
}

export interface StormTrackPoint {
  date: string
  lng: number
  lat: number
  wind: number
  pressure: number
  code: StormCode
  description: string
  source?: string
  first_seen?: string
}

export interface StormForecastBatch {
  source: string
  issued_at: string
  points: StormTrackPoint[]
}

export interface StormTrack {
  id: string
  info: {
    name: string
    title: string
    type: string
    active: boolean
    season: string
    agencies: string
    cma_tfid: string | null
  }
  last_updated: string
  track_history: StormTrackPoint[]
  forecasts: StormForecastBatch[]
}

const WIND_LEVEL = '850hPa'
const TEMP_LEVEL = '850hPa'
const DEFAULT_TEMP_VARIABLE: TempVariable = 'temp'
const DEFAULT_CLOUD_TYPE: CloudType = 'tcdc'
const DEFAULT_CLOUD_VARIABLE: CloudVariable = 'cloud'

/**
 * 从升序时间戳数组中找出最接近 target 的那个。
 * 纯函数，无副作用，便于单独测试。
 */
export function findClosestTimestamp(timestamps: number[], target: number): number {
  if (timestamps.length === 0)
    return target
  let closest = timestamps[0]!
  let minDiff = Infinity
  for (const t of timestamps) {
    const diff = Math.abs(t - target)
    if (diff < minDiff) {
      minDiff = diff
      closest = t
    }
  }
  return closest
}

export const useTimelineStore = defineStore('timeline', () => {
  // --- STATE ---
  const timestamps = ref<number[]>([])
  const currentTimestampIndex = ref(0)
  const isPlaying = ref(false)
  const animationSpeed = useLocalStorage<AnimationSpeed>('ze-animation-speed', 'medium') // 动画速度
  const animationDuration = useLocalStorage<AnimationDuration>('ze-animation-duration', 6) // 动画回溯时长 (小时)
  const loopPlayback = useLocalStorage<boolean>('ze-loop-playback', true) // 是否循环播放
  const animationStyle = useLocalStorage<AnimationStyle>('ze-animation-style', 'fast') // 动画风格
  const controlStyle = useLocalStorage<TimelineControlStyle>('ze-control-style', 'classic') // 时间轴控制样式
  // --- 地图投影状态，默认为平面 ---
  const mapProjection = useLocalStorage<MapProjection>('ze-map-projection', 'mercator')
  const activeBaseMap = useLocalStorage<BaseMapType>('ze-active-base-map', MAP_STYLE_OPTIONS[0]!.id)
  const showBoundaries = useLocalStorage<boolean>('ze-show-boundaries', true)
  const showCities = useLocalStorage<boolean>('ze-show-cities', true)
  const showTileGrid = useLocalStorage<boolean>('ze-show-tile-grid', false)
  // --- 卫星云图图层可见性 ---
  const showSatelliteCloud = useLocalStorage<boolean>('ze-show-satellite-cloud', true)
  const satelliteVisibility = useLocalStorage<Record<string, boolean>>('ze-satellite-visibility', () => {
    const map: Record<string, boolean> = {}
    for (const sat of SATELLITES)
      map[sat.id] = true
    return map
  })
  // --- 火烧云图层 ---
  const chromaticSkyManifest = ref<ChromaticSkyResource[]>([])
  const chromaticSkySelection = ref<ChromaticSkyResource | null>(null)
  const showChromaticSky = useLocalStorage<boolean>('ze-show-chromatic-sky', true)
  // --- 风力图层 ---
  const showWind = useLocalStorage<boolean>('ze-show-wind', false)
  const windTimestamps = ref<number[]>([])
  const selectedWindTimestamp = ref<number | null>(null)
  const windCurrentZoom = ref(5)
  const windOptions = useLocalStorage<{
    colorBySpeed: boolean
    zoomParams: Record<number, { velocityScale: number, fadeOpacity: number, particleCount: number }>
  }>('ze-wind-options', () => ({
    colorBySpeed: false,
    zoomParams: {},
  }))
  // --- 温度图层 ---
  const showTemp = useLocalStorage<boolean>('ze-show-temp', false)
  const tempTimestamps = ref<number[]>([])
  const selectedTempTimestamp = ref<number | null>(null)
  const tempVariable = useLocalStorage<TempVariable>('ze-temp-variable', DEFAULT_TEMP_VARIABLE)
  const tempOpacity = useLocalStorage<number>('ze-temp-opacity', 0.6)
  // --- 云量图层 ---
  const showCloud = useLocalStorage<boolean>('ze-show-cloud', false)
  const cloudTimestamps = ref<number[]>([])
  const selectedCloudTimestamp = ref<number | null>(null)
  const cloudType = useLocalStorage<CloudType>('ze-cloud-type', DEFAULT_CLOUD_TYPE)
  const cloudVariable = useLocalStorage<CloudVariable>('ze-cloud-variable', DEFAULT_CLOUD_VARIABLE)
  const cloudOpacity = useLocalStorage<number>('ze-cloud-opacity', 0.7)
  // --- 台风图层 ---
  const showTyphoon = useLocalStorage<boolean>('ze-show-typhoon', true)
  const activeStorms = ref<StormActiveItem[]>([])
  const stormTracks = ref<Record<string, StormTrack>>({})
  const stormTracksLoading = ref(false)
  const stormTracksFetchedAt = ref<number | null>(null)
  const stormVisibility = useLocalStorage<Record<string, boolean>>('ze-storm-visibility', {})
  // 预测机构开关，默认仅 zoom-earth 开启
  const stormForecastSources = useLocalStorage<Record<string, boolean>>(
    'ze-storm-forecast-sources',
    () => ({ 'zoom-earth': true }),
  )

  const isPreloading = ref(false)
  const mapViewerInstance = ref<InstanceType<typeof MapViewer> | null>(null)
  const statusMessage = ref('正在加载时间戳...')

  let playInterval: NodeJS.Timeout | null = null

  // --- GETTERS (COMPUTED) ---
  const selectedTimestamp = computed(() => {
    if (timestamps.value.length > 0)
      return timestamps.value[currentTimestampIndex.value]
    return null
  })

  // 根据速度设置返回具体的播放间隔(毫秒)
  const playbackIntervalMs = computed(() => {
    switch (animationSpeed.value) {
      case 'slow': return 200
      case 'medium': return 100
      case 'fast': return 50
    }
  })

  // 根据时长设置返回具体的回溯秒数
  const playbackDurationSeconds = computed(() => {
    return animationDuration.value * 60 * 60
  })

  const formattedDate = computed(() => {
    if (!selectedTimestamp.value)
      return '----/--/--'
    return new Date(selectedTimestamp.value * 1000).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  })

  const formattedTime = computed(() => {
    if (!selectedTimestamp.value)
      return '--:--'
    return new Date(selectedTimestamp.value * 1000).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Shanghai',
    })
  })

  const isFirstTimestamp = computed(() => currentTimestampIndex.value === 0)
  const isLastTimestamp = computed(() => currentTimestampIndex.value === timestamps.value.length - 1)

  /**
   * 检查是否存在比当前日期更晚的时间戳
   */
  const hasNextDay = computed(() => {
    if (!selectedTimestamp.value || isLastTimestamp.value)
      return false
    const currentDate = new Date(selectedTimestamp.value * 1000)
    currentDate.setHours(23, 59, 59, 999) // 设置为当天的最后一毫秒
    const endOfDayTimestamp = Math.floor(currentDate.getTime() / 1000)
    // 检查时间戳数组中是否存在比当天结束时间更晚的时间戳
    return timestamps.value.some(ts => ts > endOfDayTimestamp)
  })

  /**
   * 检查是否存在比当前日期更早的时间戳
   */
  const hasPrevDay = computed(() => {
    if (!selectedTimestamp.value || isFirstTimestamp.value)
      return false
    const currentDate = new Date(selectedTimestamp.value * 1000)
    currentDate.setHours(0, 0, 0, 0) // 设置为当天的第一毫秒
    const startOfDayTimestamp = Math.floor(currentDate.getTime() / 1000)
    // 检查时间戳数组中是否存在比当天开始时间更早的时间戳
    return timestamps.value.some(ts => ts < startOfDayTimestamp)
  })

  // --- ACTIONS ---
  async function fetchTimestamps() {
    const runtimeConfig = useRuntimeConfig()
    const gisServerUrl = runtimeConfig.public.gisServerUrl

    try {
      const response = await $fetch<number[]>(`${gisServerUrl}/zoom-earth-tiles/himawari/timestamps.json`).catch((e) => {
        console.error('加载 Himawari 时间戳失败:', e); return []
      })

      timestamps.value = response
      if (timestamps.value.length > 0) {
        currentTimestampIndex.value = timestamps.value.length - 1
        statusMessage.value = ''
      }
      else {
        statusMessage.value = '未找到任何有效的时间戳。'
      }
    }
    catch (error: any) {
      console.error(error)
      statusMessage.value = `加载失败：${error.message}。请确保 GIS 服务器正在运行并且允许跨域。`
    }
  }

  async function fetchChromaticSkyManifest() {
    const runtimeConfig = useRuntimeConfig()
    const baseUrl = runtimeConfig.public.gisServerUrl as string
    try {
      const response = await $fetch<{ resources: ChromaticSkyResource[] }>(`${baseUrl}/chroma-sky-tiles/tiles_manifest.json`)
      chromaticSkyManifest.value = response.resources ?? []
    }
    catch (e) {
      console.error('加载火烧云清单失败:', e)
    }
  }

  function setChromaticSkySelection(resource: ChromaticSkyResource | null) {
    chromaticSkySelection.value = resource
  }

  // --- manifest 清单拉取：风力 / 温度 / 云量 共用同一套逻辑 ---
  // 通用工厂：封装 inflight 去重、排序、对齐选中时间戳、错误处理，三者仅 URL 构造与目标 ref 不同。
  function createManifestFetcher(opts: {
    /** 相对于 gisServerUrl 的 manifest 路径（不含前缀），按需读取当前变量 */
    relativeUrl: () => string
    /** 存放拉取到的时间戳列表 */
    timestampsRef: Ref<number[]>
    /** 当前选中的时间戳 */
    selectedRef: Ref<number | null>
    /** 错误日志文案 */
    errorLabel: string
  }) {
    let inflight: Promise<void> | null = null

    async function fetch(baseUrl?: string) {
      if (inflight)
        return inflight
      inflight = (async () => {
        const url = (baseUrl ?? useRuntimeConfig().public.gisServerUrl as string) || ''
        try {
          const response = await $fetch<{ timestamps: number[] }>(`${url}/atmos-tiles/${opts.relativeUrl()}/tiles_manifest.json`)
          const ts = response.timestamps ?? []
          if (ts.length > 0) {
            const sorted = [...ts].sort((a, b) => a - b)
            opts.timestampsRef.value = sorted
            // 当前选中不在列表中时，对齐到最接近主时间轴的那一个
            if (!sorted.includes(opts.selectedRef.value ?? 0)) {
              const target = selectedTimestamp.value ?? sorted.at(-1)!
              opts.selectedRef.value = findClosestTimestamp(sorted, target)
            }
          }
        }
        catch (e) {
          console.error(`${opts.errorLabel}:`, e)
        }
        finally {
          inflight = null
        }
      })()
      return inflight
    }

    function reset() {
      opts.timestampsRef.value = []
      opts.selectedRef.value = null
      inflight = null
    }

    return { fetch, reset, _inflight: () => inflight }
  }

  // --- 风力图层 Actions ---
  const windManifest = createManifestFetcher({
    relativeUrl: () => `wind/${WIND_LEVEL}`,
    timestampsRef: windTimestamps,
    selectedRef: selectedWindTimestamp,
    errorLabel: '加载风力清单失败',
  })

  // --- 温度图层 Actions ---
  const tempManifest = createManifestFetcher({
    relativeUrl: () => `${tempVariable.value}/${TEMP_LEVEL}`,
    timestampsRef: tempTimestamps,
    selectedRef: selectedTempTimestamp,
    errorLabel: '加载温度清单失败',
  })

  // --- 云量图层 Actions ---
  const cloudManifest = createManifestFetcher({
    relativeUrl: () => cloudVariable.value === 'vis' ? 'vis/surface' : `${cloudType.value}/atmos`,
    timestampsRef: cloudTimestamps,
    selectedRef: selectedCloudTimestamp,
    errorLabel: '加载云量清单失败',
  })

  // --- 台风图层 Actions ---
  async function fetchActiveStorms() {
    const base = useRuntimeConfig().public.gisServerUrl as string
    if (!base)
      return
    stormTracksLoading.value = true
    try {
      const data = await $fetch<{ fetched_at: string, storms: StormActiveItem[] }>(`${base}/storm/storms_active.json`)
      activeStorms.value = data.storms ?? []
      // 默认对每个 storm 开启可见
      for (const s of activeStorms.value) {
        if (stormVisibility.value[s.id] === undefined)
          stormVisibility.value[s.id] = true
      }
      // 并发拉每个 track（只拉已关注的 storm，扰动不拉）
      await Promise.all(
        activeStorms.value
          .filter(s => s.kind === 'storm' && s.watched)
          .map(async (s) => {
            if (stormTracks.value[s.id])
              return
            try {
              const t = await $fetch<StormTrack>(`${base}/storm/tracks/${s.id}.json`)
              stormTracks.value[s.id] = t
            }
            catch (e) {
              console.error(`加载台风 ${s.id} 路径失败:`, e)
            }
          }),
      )
      stormTracksFetchedAt.value = Date.now()
    }
    finally {
      stormTracksLoading.value = false
    }
  }

  function refreshStormTracks() {
    stormTracks.value = {}
    stormTracksFetchedAt.value = null
    return fetchActiveStorms()
  }

  /**
   * 在给定的时间戳数组中找到最接近目标时间戳的那个，并返回其在 timestamps 数组中的索引
   * @param targetTimestamp 目标时间戳
   * @param searchScope 要在哪个范围里搜索，默认为全部时间戳
   */
  function findClosestTimestampIndex(targetTimestamp: number, searchScope: number[] = timestamps.value): number {
    if (!searchScope.length)
      return -1

    const closestTs = searchScope.reduce((prev, curr) => {
      return (Math.abs(curr - targetTimestamp) < Math.abs(prev - targetTimestamp) ? curr : prev)
    })

    return timestamps.value.indexOf(closestTs)
  }

  function nextDay() {
    if (!selectedTimestamp.value)
      return

    const currentDate = new Date(selectedTimestamp.value * 1000)
    const targetDate = new Date(currentDate)
    targetDate.setDate(targetDate.getDate() + 1)
    const targetTimestamp = Math.floor(targetDate.getTime() / 1000)

    const timestampsOnNextDay = timestamps.value.filter((ts) => {
      const d = new Date(ts * 1000)
      return d.getFullYear() === targetDate.getFullYear()
        && d.getMonth() === targetDate.getMonth()
        && d.getDate() === targetDate.getDate()
    })

    if (timestampsOnNextDay.length > 0) {
      const newIndex = findClosestTimestampIndex(targetTimestamp, timestampsOnNextDay)
      if (newIndex !== -1)
        currentTimestampIndex.value = newIndex
    }
    else {
      goToLatest()
    }
  }

  function prevDay() {
    if (!selectedTimestamp.value)
      return

    const currentDate = new Date(selectedTimestamp.value * 1000)
    const targetDate = new Date(currentDate)
    targetDate.setDate(targetDate.getDate() - 1)
    const targetTimestamp = Math.floor(targetDate.getTime() / 1000)

    const timestampsOnPrevDay = timestamps.value.filter((ts) => {
      const d = new Date(ts * 1000)
      return d.getFullYear() === targetDate.getFullYear()
        && d.getMonth() === targetDate.getMonth()
        && d.getDate() === targetDate.getDate()
    })

    if (timestampsOnPrevDay.length > 0) {
      const newIndex = findClosestTimestampIndex(targetTimestamp, timestampsOnPrevDay)
      if (newIndex !== -1)
        currentTimestampIndex.value = newIndex
    }
  }

  function nextTimestamp() {
    if (!isLastTimestamp.value)
      currentTimestampIndex.value++
  }

  function prevTimestamp() {
    if (!isFirstTimestamp.value)
      currentTimestampIndex.value--
  }

  function goToLatest() {
    if (!isLastTimestamp.value)
      currentTimestampIndex.value = timestamps.value.length - 1
  }

  async function togglePlay() {
    if (isPlaying.value) {
      isPlaying.value = false
      isPreloading.value = false
      if (playInterval) {
        clearInterval(playInterval)
        playInterval = null
      }
      return
    }

    isPlaying.value = true
    const baseTimestamp = selectedTimestamp.value
    if (!baseTimestamp)
      return

    const targetTimestamp = baseTimestamp - playbackDurationSeconds.value
    const startIndex = findClosestTimestampIndex(targetTimestamp)
    if (startIndex === -1)
      return

    const endIndex = timestamps.value.length - 1
    const timestampsToPlay = timestamps.value.slice(startIndex, endIndex + 1)

    const playLoop = () => {
      if (!isPlaying.value)
        return
      currentTimestampIndex.value++
      if (currentTimestampIndex.value > endIndex) {
        if (loopPlayback.value) {
          currentTimestampIndex.value = startIndex
          playInterval = setTimeout(playLoop, 500)
        }
        else {
          togglePlay()
        }
      }
      else {
        playInterval = setTimeout(playLoop, playbackIntervalMs.value)
      }
    }

    if (animationStyle.value === 'smooth' && !isPreloading.value) {
      isPreloading.value = true
      statusMessage.value = '首次播放：正在逐帧缓存动画...'
      for (let i = 0; i < timestampsToPlay.length; i++) {
        if (!isPlaying.value) {
          isPreloading.value = false
          statusMessage.value = ''
          return
        }
        const ts = timestampsToPlay[i]!
        currentTimestampIndex.value = startIndex + i
        await mapViewerInstance.value?.updateSatelliteLayer(ts)
      }
      isPreloading.value = false
      statusMessage.value = ''
      if (loopPlayback.value) {
        currentTimestampIndex.value = startIndex
        playInterval = setTimeout(playLoop, 500)
      }
      else {
        togglePlay()
      }
    }
    else {
      currentTimestampIndex.value = startIndex
      playLoop()
    }
  }
  // --- 切换地图投影的 Action ---
  function setMapProjection(projection: MapProjection) {
    mapProjection.value = projection
  }
  // --- 切换底图的 Action ---
  function setActiveBaseMap(type: BaseMapType) {
    activeBaseMap.value = type
  }

  function cleanup() {
    if (playInterval)
      clearInterval(playInterval)
  }

  function setMapViewerInstance(instance: InstanceType<typeof MapViewer> | null) {
    mapViewerInstance.value = instance
  }

  return {
    // State
    timestamps,
    currentTimestampIndex,
    isPlaying,
    statusMessage,
    animationSpeed,
    animationDuration,
    loopPlayback,
    animationStyle,
    controlStyle,
    isPreloading,
    mapProjection,
    activeBaseMap,
    showBoundaries,
    showCities,
    showTileGrid,
    showSatelliteCloud,
    satelliteVisibility,
    chromaticSkyManifest,
    chromaticSkySelection,
    showChromaticSky,
    showWind,
    windTimestamps,
    selectedWindTimestamp,
    windCurrentZoom,
    windOptions,
    showTemp,
    tempTimestamps,
    selectedTempTimestamp,
    tempVariable,
    tempOpacity,
    showCloud,
    cloudTimestamps,
    selectedCloudTimestamp,
    cloudType,
    cloudVariable,
    cloudOpacity,
    showTyphoon,
    activeStorms,
    stormTracks,
    stormTracksLoading,
    stormTracksFetchedAt,
    stormVisibility,
    stormForecastSources,
    // Getters
    selectedTimestamp,
    formattedDate,
    formattedTime,
    isFirstTimestamp,
    isLastTimestamp,
    hasNextDay,
    hasPrevDay,
    // Actions
    fetchTimestamps,
    nextTimestamp,
    prevTimestamp,
    nextDay,
    prevDay,
    goToLatest,
    togglePlay,
    cleanup,
    setMapViewerInstance,
    setMapProjection,
    setActiveBaseMap,
    findClosestTimestampIndex,
    fetchChromaticSkyManifest,
    setChromaticSkySelection,
    fetchWindManifests: windManifest.fetch,
    fetchTempManifests: tempManifest.fetch,
    resetTempManifests: tempManifest.reset,
    fetchCloudManifests: cloudManifest.fetch,
    resetCloudManifests: cloudManifest.reset,
    fetchActiveStorms,
    refreshStormTracks,
  }
})

// HMR (热模块重载) 支持
if (import.meta.hot)
  import.meta.hot.accept(acceptHMRUpdate(useTimelineStore, import.meta.hot))
