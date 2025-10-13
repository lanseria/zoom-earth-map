<script setup lang="ts">
import type { SatelliteSource } from '~/composables/timeline'
import maplibregl from 'maplibre-gl'
import { useTimelineStore } from '~/composables/timeline'
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
  animationStyle: {
    type: String, // 'fast' or 'smooth'
    required: true,
  },
  // --- activeSatellite prop ---
  activeSatellite: {
    type: String as PropType<SatelliteSource>,
    required: true,
  },
})

const timelineStore = useTimelineStore()
const mapContainer = ref(null)
let map: maplibregl.Map
let previousLayerId: any = null

onMounted(() => {
  if (!mapContainer.value)
    return
  const apiKey = 'COzW8kKwrFCzdf13x98K'
  map = markRaw(new maplibregl.Map({
    container: mapContainer.value,
    style: {
      version: 8,
      sources: {},
      sprite: `https://api.maptiler.com/maps/streets-v2/sprite?key=${apiKey}`,
      glyphs: `https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=${apiKey}`,
      layers: [{
        id: 'background',
        type: 'background',
        paint: {
          'background-color': '#333333',
        },
      }],
    },
    center: [120, 30],
    zoom: 5,
    minZoom: 3,
    maxZoom: 8,
    attributionControl: false,
  }))

  map.on('load', () => {
    addBoundaryLayer()
    // 使用新的城市标记图层函数
    addCityMarkersLayerWithZoomLevels()

    if (props.selectedTimestamp)
      updateSatelliteLayer(props.selectedTimestamp)
  })

  map.on('error', (e) => {
    if (e && e.error)
      console.error('MapLibre Error:', e.error.message)
  })
})

/**
 * 新的城市标记图层函数，实现分级显示
 */
async function addCityMarkersLayerWithZoomLevels() {
  try {
    const response = await fetch('/new_data.json') // 加载新数据
    if (!response.ok)
      throw new Error(`HTTP error! status: ${response.status}`)
    const citiesData = await response.json()

    // 1. 将数据转换为 GeoJSON 格式
    const geojsonData: any = {
      type: 'FeatureCollection',
      features: citiesData.map((city: any) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [city.lng, city.lat],
        },
        properties: {
          name: city.name,
          level: city.level, // 关键字段：城市级别
        },
      })),
    }

    map.addSource('cities-source', {
      type: 'geojson',
      data: geojsonData,
    })

    // 2. 省会和直辖市图层 (level 1)，在 zoom >= 3 时显示
    map.addLayer({
      id: 'capitals-points',
      type: 'circle',
      source: 'cities-source',
      minzoom: 3, // 从 zoom 3 开始显示
      filter: ['==', 'level', 1], // 筛选 level 为 1 的城市
      paint: {
        'circle-radius': 3,
        'circle-color': '#ffffff',
        'circle-stroke-width': 1,
        'circle-stroke-color': '#333333',
      },
    })

    map.addLayer({
      id: 'capitals-labels',
      type: 'symbol',
      source: 'cities-source',
      minzoom: 3,
      filter: ['==', 'level', 1],
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 13,
        'text-offset': [0, -1.8],
        'text-anchor': 'top',
        'icon-allow-overlap': true,
        'text-font': ['Noto Sans Bold'],
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#333333',
        'text-halo-width': 1,
      },
    })

    // 3. 其他主要城市图层 (level 2)，在 zoom >= 5 时显示
    map.addLayer({
      id: 'other-cities-points',
      type: 'circle',
      source: 'cities-source',
      minzoom: 5, // 从 zoom 5 开始显示
      filter: ['==', 'level', 2], // 筛选 level 为 2 的城市
      paint: {
        'circle-radius': 2.5,
        'circle-color': '#ffffff',
        'circle-stroke-width': 0.8,
        'circle-stroke-color': '#333333',
      },
    })

    map.addLayer({
      id: 'other-cities-labels',
      type: 'symbol',
      source: 'cities-source',
      minzoom: 5,
      filter: ['==', 'level', 2],
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 12,
        'text-offset': [0, -1.8],
        'text-anchor': 'top',
        'icon-allow-overlap': true,
        'text-font': ['DIN Pro Bold'],
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#333333',
        'text-halo-width': 0.9,
      },
    })
  }
  catch (error) {
    console.error('加载城市数据失败:', error)
  }
}

/**
 * 添加本地 GeoJSON 国界线图层
 */
async function addBoundaryLayer() {
  try {
    map.addSource('local-boundaries-source', {
      type: 'geojson',
      data: '/api/proxy/boundaries.json',
    })

    // 1. 添加底层轮廓线
    map.addLayer({
      id: 'country-boundaries-outline-layer',
      type: 'line',
      source: 'local-boundaries-source',
      paint: {
        'line-color': '#333333',
        'line-width': 3,
        'line-opacity': 0.8,
      },
    })

    // 2. 添加上层主线
    map.addLayer({
      id: 'country-boundaries-layer',
      type: 'line',
      source: 'local-boundaries-source',
      paint: {
        'line-color': '#ffffff',
        'line-width': 1,
      },
    })
  }
  catch (error) {
    console.error('加载本地 GeoJSON 失败:', error)
  }
}

// 监听 selectedTimestamp 的变化, 仅在非播放状态下生效
watch(() => props.selectedTimestamp, (newTimestamp, oldTimestamp) => {
  // 这个 watch 只处理手动拖动或点击时间轴的情况
  // 播放时的更新由 store 主动调用
  if (map && map.isStyleLoaded() && newTimestamp !== oldTimestamp) {
    updateSatelliteLayer(newTimestamp)
  }
})

/**
 * @param {number} timestamp
 * @returns {Promise<void>}
 */
function updateSatelliteLayer(timestamp: number): Promise<void> {
  return new Promise((resolve) => {
    if (!map || !timestamp) {
      resolve()
      return
    }

    const FADE_DURATION = props.animationStyle === 'fast' ? 500 : 0
    const newSourceId = `satellite-source-${timestamp}`
    const newLayerId = `satellite-layer-${timestamp}`

    // --- 动态构建 tileUrl ---
    let tileUrl: string
    if (props.activeSatellite === 'fy4b') {
      // 风云4B 的 URL 格式
      tileUrl = `${props.serverUrl}/fy-4b/${timestamp}/{z}/{x}/{y}.png`
    }
    else {
      // 默认使用 Himawari 的 URL 格式
      tileUrl = `${props.serverUrl}/himawari/{z}/{y}/{x}/${timestamp}.jpg`
    }

    if (map.getSource(newSourceId)) {
      if (map.getLayer(newLayerId))
        map.setPaintProperty(newLayerId, 'raster-opacity', 1)

      if (previousLayerId && previousLayerId !== newLayerId && map.getLayer(previousLayerId))
        map.setPaintProperty(previousLayerId, 'raster-opacity', 0)

      previousLayerId = newLayerId
      resolve()
      return
    }

    map.addSource(newSourceId, {
      type: 'raster',
      tiles: [tileUrl],
      tileSize: 256,
      bounds: [67.5, -60, 180, 60],
      maxzoom: 7,
    })

    const onSourceData = (e: any) => {
      if (e.sourceId === newSourceId && e.isSourceLoaded) {
        map.off('sourcedata', onSourceData)
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
        resolve()
      }
    }
    map.on('sourcedata', onSourceData)

    map.addLayer({
      id: newLayerId,
      type: 'raster',
      source: newSourceId,
      paint: {
        'raster-fade-duration': FADE_DURATION,
        'raster-opacity': 1,
      },
    }, 'country-boundaries-outline-layer')
  })
}
// --- 监听地图投影模式的变化 ---
watch(() => timelineStore.mapProjection, (newProjection) => {
  if (!map)
    return

  // 设置新的投影
  map.setProjection({
    type: newProjection,
  })
})

onUnmounted(() => {
  if (map) {
    map.remove()
  }
})

defineExpose({
  updateSatelliteLayer,
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
