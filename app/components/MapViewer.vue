// app/components/MapViewer.vue

<script setup lang="ts">
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
  animationStyle: {
    type: String, // 'fast' or 'smooth'
    required: true,
  },
})

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
          'background-color': '#000000',
        },
      }],
    },
    center: [120, 30],
    zoom: 5,
    minZoom: 3,
    maxZoom: 6,
  }))

  map.on('load', () => {
    addBoundaryLayer()
    addCityMarkersLayer()

    if (props.selectedTimestamp)
      updateSatelliteLayer(props.selectedTimestamp)
  })

  map.on('error', (e) => {
    if (e && e.error)
      console.error('MapLibre Error:', e.error.message)
  })
})

/**
 * 添加城市标记图层 (已优化)
 */
async function addCityMarkersLayer() {
  try {
    const response = await fetch('/data.json')
    if (!response.ok)
      throw new Error(`HTTP error! status: ${response.status}`)
    const citiesData = await response.json()

    // 1. 过滤数据，让城市显示更稀疏
    const filteredCities = citiesData.filter((item: any) => item.area === '')

    // 2. 将过滤后的数据转换为 GeoJSON
    const geojsonData: any = {
      type: 'FeatureCollection',
      features: filteredCities.map((city: any) => {
        let name = ''
        if (city.city === '市辖区') {
          name = city.province
        }
        else {
          name = city.city
        }
        return {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [Number.parseFloat(city.lng), Number.parseFloat(city.lat)],
          },
          properties: {
            name,
          },
        }
      }),
    }

    map.addSource('cities-source', {
      type: 'geojson',
      data: geojsonData,
    })

    // 3. 绘制城市圆点 (白底黑边)
    map.addLayer({
      id: 'cities-points-layer',
      type: 'circle',
      source: 'cities-source',
      paint: {
        'circle-radius': 2,
        'circle-color': '#ffffff', // 白色填充
        'circle-stroke-width': 0.8, // 描边宽度
        'circle-stroke-color': '#000000', // 黑色描边
      },
    })

    // 4. 显示城市名称
    map.addLayer({
      id: 'cities-labels-layer',
      type: 'symbol',
      source: 'cities-source',
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 12,
        'text-offset': [0, -1.8], // 稍微调整偏移，让文字更贴近点
        'text-anchor': 'top', // 锚点在底部，文字在点上方
        'icon-allow-overlap': true,
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#000000',
        'text-halo-width': 0.9,
      },
    })
  }
  catch (error) {
    console.error('加载城市数据失败:', error)
  }
}

/**
 * 添加本地 GeoJSON 国界线图层 (已优化)
 */
async function addBoundaryLayer() {
  try {
    map.addSource('local-boundaries-source', {
      type: 'geojson',
      data: '/api/proxy/boundaries.json',
    })

    // 1. 添加底层轮廓线 (粗, 黑色)
    map.addLayer({
      id: 'country-boundaries-outline-layer',
      type: 'line',
      source: 'local-boundaries-source',
      paint: {
        'line-color': '#000000',
        'line-width': 3,
        'line-opacity': 0.8,
      },
    })

    // 2. 添加上层主线 (细, 白色)
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
 * 更新卫星图层的核心函数，现在返回一个 Promise，在图层加载完成后 resolve
 * @param {number} timestamp - 新的时间戳
 * @returns {Promise<void>}
 */
function updateSatelliteLayer(timestamp: number): Promise<void> {
  return new Promise((resolve) => {
    if (!map || !timestamp) {
      resolve()
      return
    }

    const FADE_DURATION = props.animationStyle === 'fast' ? 500 : 0 // 平滑模式预加载时不使用淡入淡出
    const newSourceId = `satellite-source-${timestamp}`
    const newLayerId = `satellite-layer-${timestamp}`
    const tileUrl = `${props.serverUrl}/himawari/{z}/{y}/{x}/${timestamp}.jpg`

    if (map.getSource(newSourceId)) {
      // 如果图层已存在，直接显示它并隐藏旧的
      if (map.getLayer(newLayerId))
        map.setPaintProperty(newLayerId, 'raster-opacity', 1)

      if (previousLayerId && previousLayerId !== newLayerId && map.getLayer(previousLayerId))
        map.setPaintProperty(previousLayerId, 'raster-opacity', 0)

      previousLayerId = newLayerId
      resolve() // 已存在，立即完成
      return
    }

    map.addSource(newSourceId, {
      type: 'raster',
      tiles: [tileUrl],
      tileSize: 256,
      bounds: [67.5, -60, 180, 60],
    })

    // 监听新 source 加载完成事件
    const onSourceData = (e: any) => {
      if (e.sourceId === newSourceId && e.isSourceLoaded) {
        map.off('sourcedata', onSourceData)
        // 在 source 加载完成后，再处理旧图层的移除，确保平滑
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
        resolve() // 新图层加载并显示完成
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

onUnmounted(() => {
  if (map) {
    map.remove()
  }
})

// 将方法暴露给父组件
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
