<template>
  <div ref="mapContainer" class="map-container"></div>
</template>

<script setup>
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const props = defineProps({
  selectedTimestamp: {
    type: Number,
    required: true,
  },
  serverUrl: {
    type: String,
    required: true,
  }
});

const mapContainer = ref(null);
let map = null;

const SATELLITE_LAYER_ID = 'satellite-tiles-layer';
const SATELLITE_SOURCE_ID = 'satellite-tiles-source';

onMounted(() => {
  if (!mapContainer.value) return;

  map = new maplibregl.Map({
    container: mapContainer.value,
    style: {
      version: 8,
      sources: {
        'opentopomap-tiles': {
          type: 'raster',
          tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: 'Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA)',
        },
      },
      layers: [
        {
          id: 'simple-tiles',
          type: 'raster',
          source: 'opentopomap-tiles',
          minzoom: 0,
          maxzoom: 22,
        },
      ],
    },
    center: [135, 35],
    zoom: 3,
  });

  map.on('load', () => {
    // 初始加载时，添加一次图层
    addOrUpdateSatelliteLayer(props.selectedTimestamp);
  });
});

// 监听 selectedTimestamp 的变化
watch(() => props.selectedTimestamp, (newTimestamp) => {
  if (map && map.isStyleLoaded()) {
    // 当时间戳变化时，调用更新函数
    addOrUpdateSatelliteLayer(newTimestamp);
  }
});

// vvvvvvvvvvvvvv   这是核心的修正逻辑   vvvvvvvvvvvvvv
function addOrUpdateSatelliteLayer(timestamp) {
  if (!map || !timestamp) return;

  // 构造包含真实时间戳的 URL
  const tileUrl = `${props.serverUrl}/himawari/{z}/{y}/{x}/${timestamp}.jpg`;

  // 检查数据源是否已存在
  const source = map.getSource(SATELLITE_SOURCE_ID);

  if (source) {
    // 如果已存在，我们先移除旧的图层和数据源
    // 这是最可靠的更新方式
    if (map.getLayer(SATELLITE_LAYER_ID)) {
      map.removeLayer(SATELLITE_LAYER_ID);
    }
    map.removeSource(SATELLITE_SOURCE_ID);
  }

  // 重新添加数据源，这次 URL 里的时间戳是固定的
  map.addSource(SATELLITE_SOURCE_ID, {
    type: 'raster',
    tiles: [tileUrl], // 使用已经包含真实时间戳的 URL
    tileSize: 256,
    bounds: [67.5, -60, 180, 60],
  });

  // 重新添加图层
  map.addLayer({
    id: SATELLITE_LAYER_ID,
    type: 'raster',
    source: SATELLITE_SOURCE_ID,
    paint: {
      'raster-fade-duration': 150,
    }
  });
}
// ^^^^^^^^^^^^^^   核心修正逻辑结束   ^^^^^^^^^^^^^^

onUnmounted(() => {
  if (map) {
    map.remove();
    map = null;
  }
});
</script>

<style scoped>
.map-container {
  width: 100%;
  height: 100%;
}
</style>