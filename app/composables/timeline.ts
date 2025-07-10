// app/composables/timeline.ts

import { acceptHMRUpdate, defineStore } from 'pinia'

export const useTimelineStore = defineStore('timeline', () => {
  // --- STATE ---
  const timestamps = ref<number[]>([])
  const currentTimestampIndex = ref(0)
  const isPlaying = ref(false)
  const statusMessage = ref('正在加载时间戳...')

  let playInterval: NodeJS.Timeout | null = null

  // --- GETTERS (COMPUTED) ---
  const selectedTimestamp = computed(() => {
    if (timestamps.value.length > 0)
      return timestamps.value[currentTimestampIndex.value]
    return null
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

  function togglePlay() {
    isPlaying.value = !isPlaying.value

    if (isPlaying.value) {
      // 如果当前在最后一个时间点，则从6小时前回退；否则从当前点回退
      const baseTimestamp = selectedTimestamp.value
      if (baseTimestamp) {
        // 计算6小时前的时间戳
        const SIX_HOURS_IN_SECONDS = 6 * 60 * 60
        const targetTimestamp = baseTimestamp - SIX_HOURS_IN_SECONDS

        // 找到最接近的时间点索引
        const startIndex = findClosestTimestampIndex(targetTimestamp)

        // 如果找到了有效索引，则设置为播放起点
        if (startIndex !== -1)
          currentTimestampIndex.value = startIndex
      }

      playInterval = setInterval(() => {
        if (isLastTimestamp.value) {
          togglePlay() // 到达末尾，自动停止播放
        }
        else {
          nextTimestamp()
        }
      }, 100)
    }
    else {
      if (playInterval)
        clearInterval(playInterval)
    }
  }

  // 清理定时器，防止内存泄漏
  function cleanup() {
    if (playInterval)
      clearInterval(playInterval)
  }

  return {
    // State
    timestamps,
    currentTimestampIndex,
    isPlaying,
    statusMessage,
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
  }
})

// HMR (热模块重载) 支持
if (import.meta.hot)
  import.meta.hot.accept(acceptHMRUpdate(useTimelineStore, import.meta.hot))
