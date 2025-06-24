<template>
  <div class="main-layout">
    <header class="header">
      <h1>Zoom Earth Satellite Viewer</h1>
    </header>

    <main class="content">
      <div class="map-wrapper">
        <!-- 只有在获取到时间戳后才渲染地图 -->
        <div v-if="timestamps.length > 0" class="map-area">
          <MapViewer 
            :selected-timestamp="selectedTimestamp" 
            :server-url="gisServerUrl" 
          />
        </div>
        <div v-else class="loading-state">
          <p>{{ statusMessage }}</p>
        </div>
      </div>

      <!-- 时间轴控制器 -->
      <div v-if="timestamps.length > 0" class="timeline-controls">
        <label for="timeline-slider">时间轴 ({{ formattedTimestamp }})</label>
        <div class="slider-container">
          <button @click="prevTimestamp" :disabled="isFirstTimestamp"><</button>
          <input
            id="timeline-slider"
            type="range"
            :min="0"
            :max="timestamps.length - 1"
            v-model.number="currentTimestampIndex"
            class="slider"
          />
          <button @click="nextTimestamp" :disabled="isLastTimestamp">></button>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
// GIS 服务器的 URL，最好放在运行时配置中
const runtimeConfig = useRuntimeConfig();
const gisServerUrl = runtimeConfig.public.gisServerUrl;

// 状态管理
const timestamps = ref([]); // 存储从服务器获取的所有时间戳
const currentTimestampIndex = ref(0); // 当前滑块的索引
const statusMessage = ref('正在加载时间戳...');

// 计算属性，用于获取当前选中的时间戳
const selectedTimestamp = computed(() => {
  if (timestamps.value.length > 0) {
    return timestamps.value[currentTimestampIndex.value];
  }
  return null;
});

// 计算属性，用于显示格式化的时间
const formattedTimestamp = computed(() => {
  if (selectedTimestamp.value) {
    return new Date(selectedTimestamp.value * 1000).toLocaleString('zh-CN');
  }
  return 'N/A';
});

// 计算属性，判断是否在第一个/最后一个时间戳
const isFirstTimestamp = computed(() => currentTimestampIndex.value === 0);
const isLastTimestamp = computed(() => currentTimestampIndex.value === timestamps.value.length - 1);


// --- 方法 ---

// 获取时间戳列表
async function fetchTimestamps() {
  try {
    const response = await fetch(`${gisServerUrl}/himawari/timestamps.json`);
    if (!response.ok) {
      throw new Error(`无法获取时间戳列表: ${response.statusText}`);
    }
    const data = await response.json();
    if (data && data.length > 0) {
      timestamps.value = data;
      // 默认将滑块设置到最新的时间点（数组最后）
      currentTimestampIndex.value = data.length - 1;
      statusMessage.value = '';
    } else {
      statusMessage.value = '未找到任何有效的时间戳。';
    }
  } catch (error) {
    console.error(error);
    statusMessage.value = `加载失败：${error.message}。请确保 GIS 服务器正在运行并且允许跨域。`;
  }
}

// 前进/后退按钮的逻辑
function prevTimestamp() {
  if (!isFirstTimestamp.value) {
    currentTimestampIndex.value--;
  }
}

function nextTimestamp() {
  if (!isLastTimestamp.value) {
    currentTimestampIndex.value++;
  }
}

// --- 生命周期钩子 ---
// 在客户端挂载时获取数据
onMounted(() => {
  fetchTimestamps();
});
</script>

<style>
/* 全局样式 */
body, html {
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background-color: #f0f2f5;
  color: #333;
}

.main-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.header {
  background-color: #fff;
  padding: 1rem;
  border-bottom: 1px solid #ddd;
  text-align: center;
  flex-shrink: 0;
}

.header h1 {
  margin: 0;
  font-size: 1.5rem;
}

.content {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
}

.map-wrapper {
  flex-grow: 1;
  position: relative; /* 为子元素定位 */
}

.map-area {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.loading-state {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  font-size: 1.2rem;
  color: #888;
}

.timeline-controls {
  flex-shrink: 0;
  padding: 1rem;
  background-color: #fff;
  border-top: 1px solid #ddd;
  text-align: center;
}

.timeline-controls label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: bold;
}

.slider-container {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
}

.slider {
  width: 70%;
  max-width: 800px;
}

.slider-container button {
  padding: 0.5rem 1rem;
  border: 1px solid #ccc;
  background-color: #fff;
  border-radius: 4px;
  cursor: pointer;
  font-size: 1rem;
}

.slider-container button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>