// app/composables/timeline.ts

import type MapViewer from '~/components/MapViewer.vue'
import { acceptHMRUpdate, defineStore } from 'pinia'

export type AnimationSpeed = 'slow' | 'medium' | 'fast'
export type AnimationDuration = 3 | 6 | 12 | 24
export type AnimationStyle = 'fast' | 'smooth'

export const useTimelineStore = defineStore('timeline', () => {
  // --- STATE ---
  const timestamps = ref<number[]>([])
  const currentTimestampIndex = ref(0)
  const isPlaying = ref(false)
  const animationSpeed = ref<AnimationSpeed>('medium') // 动画速度
  const animationDuration = ref<AnimationDuration>(6) // 动画回溯时长 (小时)
  const loopPlayback = ref(true) // 是否循环播放
  const animationStyle = ref<AnimationStyle>('fast') // 动画风格
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
    // 获取运行时配置
    const runtimeConfig = useRuntimeConfig()
    const gisServerUrl = runtimeConfig.public.gisServerUrl

    try {
      const response = await $fetch<number[]>(`${gisServerUrl}/himawari/timestamps.json`)
      if (response && response.length > 0) {
        timestamps.value = response
        // 默认定位到最新
        currentTimestampIndex.value = response.length - 1
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
   * 在给定的时间戳数组中找到最接近目标时间戳的那个，并返回其在 **全局** timestamps 数组中的索引
   * @param targetTimestamp 目标时间戳
   * @param searchScope 要在哪个范围里搜索，默认为全部
   */
  function findClosestTimestampIndex(targetTimestamp: number, searchScope: number[] = timestamps.value): number {
    if (!searchScope.length)
      return -1

    const closestTs = searchScope.reduce((prev, curr) => {
      return (Math.abs(curr - targetTimestamp) < Math.abs(prev - targetTimestamp) ? curr : prev)
    })

    return timestamps.value.indexOf(closestTs)
  }

  /**
   * 跳转到下一天的大致相同时间
   */
  function nextDay() {
    if (!selectedTimestamp.value)
      return

    const currentDate = new Date(selectedTimestamp.value * 1000)
    const targetDate = new Date(currentDate)
    targetDate.setDate(targetDate.getDate() + 1)
    const targetTimestamp = Math.floor(targetDate.getTime() / 1000)

    // 筛选出属于目标日期的所有时间戳
    const timestampsOnNextDay = timestamps.value.filter((ts) => {
      const d = new Date(ts * 1000)
      return d.getFullYear() === targetDate.getFullYear()
        && d.getMonth() === targetDate.getMonth()
        && d.getDate() === targetDate.getDate()
    })

    if (timestampsOnNextDay.length > 0) {
      // 在当天的范围内查找最接近的时间点
      const newIndex = findClosestTimestampIndex(targetTimestamp, timestampsOnNextDay)
      if (newIndex !== -1)
        currentTimestampIndex.value = newIndex
    }
    else {
      // 如果下一天没有数据，则跳转到最新
      goToLatest()
    }
  }

  /**
   * 跳转到上一天的大致相同时间
   */
  function prevDay() {
    if (!selectedTimestamp.value)
      return

    const currentDate = new Date(selectedTimestamp.value * 1000)
    const targetDate = new Date(currentDate)
    targetDate.setDate(targetDate.getDate() - 1)
    const targetTimestamp = Math.floor(targetDate.getTime() / 1000)

    // 筛选出属于目标日期的所有时间戳
    const timestampsOnPrevDay = timestamps.value.filter((ts) => {
      const d = new Date(ts * 1000)
      return d.getFullYear() === targetDate.getFullYear()
        && d.getMonth() === targetDate.getMonth()
        && d.getDate() === targetDate.getDate()
    })

    if (timestampsOnPrevDay.length > 0) {
      // 在当天的范围内查找最接近的时间点
      const newIndex = findClosestTimestampIndex(targetTimestamp, timestampsOnPrevDay)
      if (newIndex !== -1)
        currentTimestampIndex.value = newIndex
    }
    // 如果上一天没有数据，则什么都不做（因为按钮会被禁用）
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
  /**
   * 播放逻辑重构
   */
  async function togglePlay() {
    if (isPlaying.value) {
      // --- 停止播放 ---
      isPlaying.value = false
      isPreloading.value = false
      if (playInterval) {
        clearInterval(playInterval)
        playInterval = null
      }
      return
    }

    // --- 开始播放 ---
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

    // 定义一个可复用的播放函数
    const playLoop = () => {
      // 检查是否已停止
      if (!isPlaying.value)
        return

      currentTimestampIndex.value++

      if (currentTimestampIndex.value > endIndex) {
        if (loopPlayback.value) {
          currentTimestampIndex.value = startIndex
          playInterval = setTimeout(playLoop, 500)
        }
        else {
          togglePlay() // 播放结束
        }
      }
      else {
        playInterval = setTimeout(playLoop, playbackIntervalMs.value)
      }
    }

    // --- 根据动画风格选择播放模式 ---
    if (animationStyle.value === 'smooth' && !isPreloading.value) {
      // --- 平滑模式的首次预加载播放 ---
      isPreloading.value = true
      statusMessage.value = '首次播放：正在逐帧缓存动画...'

      for (let i = 0; i < timestampsToPlay.length; i++) {
        // 如果在预加载过程中用户点击了暂停
        if (!isPlaying.value) {
          isPreloading.value = false
          statusMessage.value = ''
          return
        }
        const ts = timestampsToPlay[i]!
        currentTimestampIndex.value = startIndex + i
        // 等待这一帧的图层加载完成
        await mapViewerInstance.value?.updateSatelliteLayer(ts)
      }

      isPreloading.value = false
      statusMessage.value = ''
      // 预加载完成后，如果是循环播放，则无缝衔接到常规播放
      if (loopPlayback.value) {
        currentTimestampIndex.value = startIndex
        playInterval = setTimeout(playLoop, 500)
      }
      else {
        togglePlay() // 播放完成
      }
    }
    else {
      // --- 快速模式 或 平滑模式的后续播放 ---
      currentTimestampIndex.value = startIndex
      playLoop()
    }
  }

  // 清理定时器，防止内存泄漏
  function cleanup() {
    if (playInterval)
      clearInterval(playInterval)
  }
  // 新增：设置地图组件实例
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
    isPreloading,
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
  }
})

// HMR (热模块重载) 支持
if (import.meta.hot)
  import.meta.hot.accept(acceptHMRUpdate(useTimelineStore, import.meta.hot))
