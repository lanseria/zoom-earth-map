<template>
  <div ref="mapContainer" class="map-container" />
</template>

<script setup>
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

const props = defineProps({
  selectedTimestamp: {
    type: Number,
    required: true,
  },
  serverUrl: {
    type: String,
    required: true,
  },
})

const mapContainer = ref(null)
let map = null
// 用于跟踪上一个图层ID，以便在添加新图层后将其移除
let previousLayerId = null

onMounted(() => {
  if (!mapContainer.value)
    return

  map = new maplibregl.Map({
    container: mapContainer.value,
    // 使用一个极简的样式，只包含黑色背景
    style: {
      version: 8,
      sources: {},
      layers: [{
        id: 'background',
        type: 'background',
        paint: {
          'background-color': '#000000',
        },
      }],
    },
    center: [135, 35],
    zoom: 2,
  })

  map.on('load', () => {
    if (props.selectedTimestamp)
      updateSatelliteLayer(props.selectedTimestamp)
  })
})

// 监听 selectedTimestamp 的变化
watch(() => props.selectedTimestamp, (newTimestamp, oldTimestamp) => {
  // 确保地图已加载且新旧时间戳不同
  if (map && map.isStyleLoaded() && newTimestamp !== oldTimestamp)
    updateSatelliteLayer(newTimestamp)
})

/**
 * 更新卫星图层的核心函数，实现平滑过渡
 * @param {number} timestamp - 新的时间戳
 */
function updateSatelliteLayer(timestamp) {
  if (!map || !timestamp)
    return

  const FADE_DURATION = 500 // 毫秒，控制淡入淡出速度
  const newSourceId = `satellite-source-${timestamp}`
  const newLayerId = `satellite-layer-${timestamp}`
  const tileUrl = `${props.serverUrl}/himawari/{z}/{y}/{x}/${timestamp}.jpg`

  // 1. 添加新的数据源
  map.addSource(newSourceId, {
    type: 'raster',
    tiles: [tileUrl],
    tileSize: 256,
    bounds: [67.5, -60, 180, 60],
  })

  // 2. 添加新的图层
  map.addLayer({
    id: newLayerId,
    type: 'raster',
    source: newSourceId,
    paint: {
      'raster-fade-duration': FADE_DURATION,
      'raster-opacity': 1, // 直接设置为不透明，由 fade-duration 控制出现动画
    },
  })

  // 3. 如果存在上一个图层，在淡入动画开始后，优雅地移除它
  if (previousLayerId) {
    const oldLayerId = previousLayerId
    const oldSourceId = `satellite-source-${oldLayerId.split('-').pop()}`

    // 使用 setTimeout 来延迟移除操作。
    // 时间稍长于 FADE_DURATION，确保新图层完全加载并显示后再移除旧的。
    setTimeout(() => {
      if (map.getLayer(oldLayerId))
        map.removeLayer(oldLayerId)

      if (map.getSource(oldSourceId))
        map.removeSource(oldSourceId)
    }, FADE_DURATION + 100)
  }

  // 4. 更新 previousLayerId，为下一次切换做准备
  previousLayerId = newLayerId
}

onUnmounted(() => {
  if (map) {
    map.remove()
    map = null
  }
})
</script>

<style scoped>
.map-container {
  width: 100%;
  height: 100%;
}
/* 将MapLibre的logo颜色反转以在黑色背景上可见 */
:deep(.maplibregl-ctrl-logo) {
  filter: invert(1) grayscale(1) brightness(1.5);
}
:deep(.maplibregl-ctrl-attrib a) {
  color: #fff; /* 让 attribution 文字也变成白色 */
}
</style>