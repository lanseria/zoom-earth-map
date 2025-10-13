// app/composables/timeline.ts

import type MapViewer from '~/components/MapViewer.vue'
import type { BaseMapType } from '~/constants/map'
import { acceptHMRUpdate, defineStore } from 'pinia'
import { MAP_STYLE_OPTIONS } from '~/constants/map'

// --- 类型定义 ---
export type SatelliteSource = 'himawari' | 'fy4b'
// --- 地图投影类型 ---
export type MapProjection = 'mercator' | 'globe'

export type AnimationSpeed = 'slow' | 'medium' | 'fast'
export type AnimationDuration = 3 | 6 | 12 | 24
export type AnimationStyle = 'fast' | 'smooth'

export const useTimelineStore = defineStore('timeline', () => {
  // --- STATE ---
  // --- activeSatellite 用于追踪当前卫星源 ---
  const activeSatellite = ref<SatelliteSource>('himawari')
  // --- timestamps 现在是一个对象，存储每个源的时间戳 ---
  const timestamps = ref<Record<SatelliteSource, number[]>>({
    himawari: [],
    fy4b: [],
  })
  const currentTimestampIndex = ref(0)
  const isPlaying = ref(false)
  const animationSpeed = ref<AnimationSpeed>('medium') // 动画速度
  const animationDuration = ref<AnimationDuration>(6) // 动画回溯时长 (小时)
  const loopPlayback = ref(true) // 是否循环播放
  const animationStyle = ref<AnimationStyle>('fast') // 动画风格
  // --- 地图投影状态，默认为平面 ---
  const mapProjection = ref<MapProjection>('mercator')
  const activeBaseMap = ref<BaseMapType>(MAP_STYLE_OPTIONS[0]!.id)
  const showBoundaries = ref(true)
  const showCities = ref(true)
  const isPreloading = ref(false)
  const mapViewerInstance = ref<InstanceType<typeof MapViewer> | null>(null)
  const statusMessage = ref('正在加载时间戳...')

  let playInterval: NodeJS.Timeout | null = null

  // --- GETTERS (COMPUTED) ---
  // --- 所有计算属性现在都依赖于 activeSatellite ---
  const currentTimestamps = computed(() => timestamps.value[activeSatellite.value] || [])

  const selectedTimestamp = computed(() => {
    if (currentTimestamps.value.length > 0)
      return currentTimestamps.value[currentTimestampIndex.value]
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
  const isLastTimestamp = computed(() => currentTimestampIndex.value === currentTimestamps.value.length - 1)

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
    return currentTimestamps.value.some(ts => ts > endOfDayTimestamp)
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
    return currentTimestamps.value.some(ts => ts < startOfDayTimestamp)
  })

  // --- ACTIONS ---
  // --- fetchTimestamps 现在会获取所有源的时间戳 ---
  async function fetchTimestamps() {
    const runtimeConfig = useRuntimeConfig()
    const gisServerUrl = runtimeConfig.public.gisServerUrl

    try {
      const [himawariResponse, fy4bResponse] = await Promise.all([
        $fetch<number[]>(`${gisServerUrl}/himawari/timestamps.json`).catch((e) => {
          console.error('加载 Himawari 时间戳失败:', e); return []
        }),
        $fetch<number[]>(`${gisServerUrl}/fy-4b/timestamps.json`).catch((e) => {
          console.error('加载 风云4B 时间戳失败:', e); return []
        }),
      ])

      timestamps.value.himawari = himawariResponse
      timestamps.value.fy4b = fy4bResponse
      if (currentTimestamps.value.length > 0) {
        currentTimestampIndex.value = currentTimestamps.value.length - 1
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

  /**
   * 在给定的时间戳数组中找到最接近目标时间戳的那个，并返回其在 **当前激活卫星** timestamps 数组中的索引
   * @param targetTimestamp 目标时间戳
   * @param searchScope 要在哪个范围里搜索，默认为当前激活的卫星源
   */
  function findClosestTimestampIndex(targetTimestamp: number, searchScope: number[] = currentTimestamps.value): number {
    if (!searchScope.length)
      return -1

    const closestTs = searchScope.reduce((prev, curr) => {
      return (Math.abs(curr - targetTimestamp) < Math.abs(prev - targetTimestamp) ? curr : prev)
    })

    return currentTimestamps.value.indexOf(closestTs)
  }

  function nextDay() {
    if (!selectedTimestamp.value)
      return

    const currentDate = new Date(selectedTimestamp.value * 1000)
    const targetDate = new Date(currentDate)
    targetDate.setDate(targetDate.getDate() + 1)
    const targetTimestamp = Math.floor(targetDate.getTime() / 1000)

    const timestampsOnNextDay = currentTimestamps.value.filter((ts) => {
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

    const timestampsOnPrevDay = currentTimestamps.value.filter((ts) => {
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
      currentTimestampIndex.value = currentTimestamps.value.length - 1
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

    const endIndex = currentTimestamps.value.length - 1
    const timestampsToPlay = currentTimestamps.value.slice(startIndex, endIndex + 1)

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

  // --- 切换卫星源的 Action ---
  function setActiveSatellite(source: SatelliteSource) {
    if (activeSatellite.value === source)
      return

    // 停止当前播放
    if (isPlaying.value)
      togglePlay()

    activeSatellite.value = source

    // 重置到新数据源的最新时间戳
    if (currentTimestamps.value.length > 0) {
      currentTimestampIndex.value = currentTimestamps.value.length - 1
    }
    else {
      currentTimestampIndex.value = 0
      statusMessage.value = `卫星源 [${source}] 无可用数据。`
    }
  }

  return {
    // State
    activeSatellite,
    timestamps,
    currentTimestampIndex,
    isPlaying,
    statusMessage,
    animationSpeed,
    animationDuration,
    loopPlayback,
    animationStyle,
    isPreloading,
    mapProjection,
    activeBaseMap,
    showBoundaries,
    showCities,
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
    setActiveSatellite,
    setMapProjection,
    setActiveBaseMap,
  }
})

// HMR (热模块重载) 支持
if (import.meta.hot)
  import.meta.hot.accept(acceptHMRUpdate(useTimelineStore, import.meta.hot))
