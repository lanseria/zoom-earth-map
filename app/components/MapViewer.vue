<script setup>
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

// 不再需要 runtimeConfig 了

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
let previousLayerId = null

onMounted(() => {
  if (!mapContainer.value)
    return

  map = markRaw(new maplibregl.Map({
    container: mapContainer.value,
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
    zoom: 5,
  }))

  map.on('load', () => {
    addBoundaryLayer()

    if (props.selectedTimestamp)
      updateSatelliteLayer(props.selectedTimestamp)
  })

  map.on('error', (e) => {
    if (e && e.error)
      console.error('MapLibre Error:', e.error.message)
  })
})

/**
 * 添加本地 GeoJSON 国界线图层
 */
async function addBoundaryLayer() {
  try {
    // 1. 添加 GeoJSON 数据源，直接指向 public 目录下的文件
    map.addSource('local-boundaries-source', {
      type: 'geojson',
      data: '/china.json', // URL 指向 public 目录下的文件
    })

    // 2. 添加图层来绘制边界线
    map.addLayer({
      id: 'country-boundaries-layer',
      type: 'line',
      source: 'local-boundaries-source',
      paint: {
        'line-color': 'rgba(255, 255, 255, 0.7)',
        'line-width': 1.5,
      },
    })
  }
  catch (error) {
    console.error('加载本地 GeoJSON 失败:', error)
  }
}

// 监听 selectedTimestamp 的变化
watch(() => props.selectedTimestamp, (newTimestamp, oldTimestamp) => {
  if (map && map.isStyleLoaded() && map.getLayer('country-boundaries-layer') && newTimestamp !== oldTimestamp)
    updateSatelliteLayer(newTimestamp)
})

/**
 * 更新卫星图层的核心函数，实现平滑过渡
 * @param {number} timestamp - 新的时间戳
 */
function updateSatelliteLayer(timestamp) {
  if (!map || !timestamp)
    return

  const FADE_DURATION = 500
  const newSourceId = `satellite-source-${timestamp}`
  const newLayerId = `satellite-layer-${timestamp}`
  const tileUrl = `${props.serverUrl}/himawari/{z}/{y}/{x}/${timestamp}.jpg`

  if (map.getSource(newSourceId))
    return

  map.addSource(newSourceId, {
    type: 'raster',
    tiles: [tileUrl],
    tileSize: 256,
    bounds: [67.5, -60, 180, 60],
  })

  map.addLayer({
    id: newLayerId,
    type: 'raster',
    source: newSourceId,
    paint: {
      'raster-fade-duration': FADE_DURATION,
      'raster-opacity': 1,
    },
  }, 'country-boundaries-layer')

  if (previousLayerId) {
    const oldLayerId = previousLayerId
    const oldSourceId = `satellite-source-${oldLayerId.split('-').pop()}`
    setTimeout(() => {
      if (map.getLayer(oldLayerId))
        map.removeLayer(oldLayerId)
      if (map.getSource(oldSourceId))
        map.removeSource(oldSourceId)
    }, FADE_DURATION + 100)
  }

  previousLayerId = newLayerId
}

onUnmounted(() => {
  if (map) {
    map.remove()
    map = null
  }
})
</script>

<template>
  <div ref="mapContainer" class="map-container" />
</template>

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
