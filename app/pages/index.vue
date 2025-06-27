<script setup>
// GIS 服务器的 URL
const runtimeConfig = useRuntimeConfig()
const gisServerUrl = runtimeConfig.public.gisServerUrl

// 状态管理
const timestamps = ref([]) // 存储从服务器获取的所有时间戳
const currentTimestampIndex = ref(0) // 当前滑块的索引
const statusMessage = ref('正在加载时间戳...')
const isPlaying = ref(false) // 播放状态
let playInterval = null // 定时器实例

// 计算属性
const selectedTimestamp = computed(() => {
  if (timestamps.value.length > 0)
    return timestamps.value[currentTimestampIndex.value]
  return null
})

const formattedTimestamp = computed(() => {
  if (selectedTimestamp.value)
    return `${new Date(selectedTimestamp.value * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} UTC+8`
  return 'N/A'
})

const isFirstTimestamp = computed(() => currentTimestampIndex.value === 0)
const isLastTimestamp = computed(() => currentTimestampIndex.value === timestamps.value.length - 1)

// --- 方法 ---

// 获取时间戳列表
async function fetchTimestamps() {
  try {
    const response = await fetch(`${gisServerUrl}/himawari/timestamps.json`)
    if (!response.ok)
      throw new Error(`无法获取时间戳列表: ${response.statusText}`)

    const data = await response.json()
    if (data && data.length > 0) {
      timestamps.value = data
      // 默认将滑块设置到最新的时间点（数组最后）
      currentTimestampIndex.value = data.length - 1
      statusMessage.value = ''
    }
    else {
      statusMessage.value = '未找到任何有效的时间戳。'
    }
  }
  catch (error) {
    console.error(error)
    statusMessage.value = `加载失败：${error.message}。请确保 GIS 服务器正在运行并且允许跨域。`
  }
}

// 前进/后退按钮的逻辑
function prevTimestamp() {
  if (!isFirstTimestamp.value)
    currentTimestampIndex.value--
}

function nextTimestamp() {
  if (!isLastTimestamp.value)
    currentTimestampIndex.value++
}

// 播放/暂停逻辑
function togglePlay() {
  isPlaying.value = !isPlaying.value

  if (isPlaying.value) {
    // 如果已经在了最后一个，从头开始播放
    if (isLastTimestamp.value)
      currentTimestampIndex.value = 0

    playInterval = setInterval(() => {
      if (isLastTimestamp.value) {
        // 到达末尾，停止播放
        togglePlay()
      }
      else {
        nextTimestamp()
      }
    }, 100) // 800毫秒切换一次，可以根据需要调整
  }
  else {
    if (playInterval)
      clearInterval(playInterval)
  }
}

// --- 生命周期钩子 ---
onMounted(() => {
  fetchTimestamps()
})

onUnmounted(() => {
  // 组件卸载时清除定时器，防止内存泄漏
  if (playInterval)
    clearInterval(playInterval)
})
</script>

<template>
  <div class="font-sans flex flex-col h-screen">
    <header class="p-4 text-center border-b border-gray-200 bg-white flex-shrink-0 dark:border-gray-700 dark:bg-dark-800">
      <h1 class="text-xl m-0">
        Zoom Earth Satellite Viewer
      </h1>
    </header>

    <main class="flex flex-grow flex-col">
      <div class="flex-grow relative">
        <!-- 地图区域 -->
        <div class="inset-0 absolute">
          <!-- 只有在获取到时间戳后才渲染地图 -->
          <MapViewer
            v-if="timestamps.length > 0"
            :selected-timestamp="selectedTimestamp"
            :server-url="gisServerUrl"
          />
          <div v-else class="text-lg text-gray-500 flex h-full items-center justify-center">
            <p>{{ statusMessage }}</p>
          </div>
        </div>
      </div>

      <!-- 时间轴控制器 -->
      <div v-if="timestamps.length > 0" class="p-4 text-center border-t border-gray-200 bg-white flex-shrink-0 dark:border-gray-700 dark:bg-dark-800">
        <label for="timeline-slider" class="font-bold mb-2 block">
          时间轴 ({{ formattedTimestamp }})
        </label>
        <div class="flex gap-4 items-center justify-center">
          <!-- 播放/暂停按钮 -->
          <button class="!text-2xl icon-btn" @click="togglePlay">
            <div :class="isPlaying ? 'i-carbon-pause' : 'i-carbon-play'" />
          </button>

          <button :disabled="isFirstTimestamp || isPlaying" @click="prevTimestamp">
            <div class="i-carbon-arrow-left" />
          </button>
          <input
            id="timeline-slider"
            v-model.number="currentTimestampIndex"
            type="range"
            :min="0"
            :max="timestamps.length - 1"
            class="max-w-800px w-7/10"
            :disabled="isPlaying"
          >
          <button :disabled="isLastTimestamp || isPlaying" @click="nextTimestamp">
            <div class="i-carbon-arrow-right" />
          </button>
        </div>
      </div>
    </main>
  </div>
</template>

<!--
  <style> 块已经被完全移除，所有样式均由 UnoCSS 处理
-->
