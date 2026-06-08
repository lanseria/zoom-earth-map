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

const WIND_LEVEL = '850hPa'

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

  // --- 风力图层 Actions ---
  let windFetchPromise: Promise<void> | null = null

  async function fetchWindTimestamps(baseUrl?: string) {
    if (windFetchPromise)
      return windFetchPromise
    windFetchPromise = (async () => {
      const url = (baseUrl ?? useRuntimeConfig().public.gisServerUrl as string) || ''
      try {
        const response = await $fetch<{ timestamps: number[] }>(`${url}/wind-tiles/${WIND_LEVEL}/tiles_manifest.json`)
        const ts = response.timestamps ?? []
        if (ts.length > 0) {
          windTimestamps.value = [...ts].sort((a, b) => a - b)
          if (!windTimestamps.value.includes(selectedWindTimestamp.value ?? 0)) {
            const sat = selectedTimestamp.value ?? windTimestamps.value[windTimestamps.value.length - 1]!
            let closest = windTimestamps.value[windTimestamps.value.length - 1]!
            let minDiff = Infinity
            for (const t of windTimestamps.value) {
              const diff = Math.abs(t - sat)
              if (diff < minDiff) {
                minDiff = diff
                closest = t
              }
            }
            selectedWindTimestamp.value = closest
          }
        }
      }
      catch (e) {
        console.error('加载风力清单失败:', e)
      }
      finally {
        windFetchPromise = null
      }
    })()
    return windFetchPromise
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
    fetchWindManifests: fetchWindTimestamps,
  }
})

// HMR (热模块重载) 支持
if (import.meta.hot)
  import.meta.hot.accept(acceptHMRUpdate(useTimelineStore, import.meta.hot))
