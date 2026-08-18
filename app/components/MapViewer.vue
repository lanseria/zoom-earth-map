<script setup lang="ts">
import maplibregl from 'maplibre-gl'
import { createMapStyle } from '~/constants/map'
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
    type: String,
    required: true,
  },
})

const timelineStore = useTimelineStore()
const mapContainer = ref(null)
let map: maplibregl.Map

// 通过运行时配置注入地图服务 API Key 与内网服务地址，避免硬编码入库
const { mapTilerKey, tdtKey, cityDetailUrl, glowIndexApiUrl } = useRuntimeConfig().public

// --- 图层 composables ---
// map 在 onMounted 才赋值，故用 getter 延迟读取；watch 在 setup 阶段注册，回调运行时 map 已就绪
const getMap = (): maplibregl.Map => map
const { applyBaseMap } = useBaseMap(getMap)
const { addBoundaries } = useBoundaries(getMap)
const { addCityMarkers } = useCityMarkers(getMap, { cityDetailUrl })
const { updateSatelliteLayer } = useSatelliteTiles(getMap, {
  serverUrl: props.serverUrl,
  animationStyle: props.animationStyle,
  selectedTimestamp: () => props.selectedTimestamp,
})
const { addChromaticSky } = useChromaticSky(getMap, { serverUrl: props.serverUrl, glowIndexApiUrl })
const { addTemp } = useTempLayer(getMap, { serverUrl: props.serverUrl })
const { addCloud } = useCloudLayer(getMap, { serverUrl: props.serverUrl })
const { addWind } = useWindLayer(getMap, { serverUrl: props.serverUrl })
const {
  addStorm,
  stormOverlayVisible,
  stormOverlay,
  overlaySize,
  onStormHover,
  onStormClick,
} = useStormOverlay(getMap)
const { initTileGrid } = useTileGrid(getMap)
const { applyProjection } = useMapProjection(getMap)

onMounted(() => {
  if (!mapContainer.value)
    return
  map = markRaw(new maplibregl.Map({
    container: mapContainer.value,
    style: createMapStyle({ mapTilerKey, tdtKey }),
    center: [120, 30],
    zoom: 5,
    minZoom: 3,
    maxZoom: 8,
    attributionControl: false,
    hash: true,
  }))

  map.on('load', () => {
    // 1. 设置初始底图可见性（此时可以保证地图样式已加载）
    applyBaseMap(timelineStore.activeBaseMap)
    // 调用时，这些函数内部会读取 store 的初始状态来设置可见性
    addBoundaries()
    addCityMarkers()
    if (props.selectedTimestamp)
      updateSatelliteLayer(props.selectedTimestamp)
    addChromaticSky()
    if (timelineStore.showTemp)
      timelineStore.fetchTempManifests(props.serverUrl).then(() => addTemp())
    if (timelineStore.showCloud)
      timelineStore.fetchCloudManifests(props.serverUrl).then(() => addCloud())
    addWind()
    addStorm()
    // 恢复存储的投影设置
    applyProjection()
    // 初始化贴图网格
    initTileGrid()
  })

  map.on('error', (e) => {
    if (e && e.error)
      console.error('MapLibre Error:', e.error.message)
  })
})

onUnmounted(() => {
  // 各图层的事件监听与 source/layer 清理已由对应 composable 的 onScopeDispose 接管；
  // 这里仅销毁地图实例本身。
  if (map)
    map.remove()
})

defineExpose({
  updateSatelliteLayer,
  /** 供覆盖层 UI 组件访问地图实例（如云高测量的点击拾取） */
  getMapInstance: (): maplibregl.Map | undefined => map,
})
</script>

<template>
  <div class="map-wrapper">
    <div ref="mapContainer" class="map-container" />
    <!-- 台风 SVG overlay：浮在风力粒子 canvas 之上，确保台风点线不被粒子遮挡 -->
    <svg
      v-show="stormOverlayVisible"
      class="typhoon-overlay"
      :width="overlaySize.width"
      :height="overlaySize.height"
      :viewBox="`0 0 ${overlaySize.width} ${overlaySize.height}`"
    >
      <!-- 实况线 -->
      <path
        v-for="l in stormOverlay.actualLines" :key="l.key"
        :d="l.d" :stroke="l.stroke" :stroke-width="l.strokeWidth"
        :stroke-opacity="l.strokeOpacity" stroke-linecap="round" stroke-linejoin="round" fill="none"
      />
      <!-- 预测线（虚线） -->
      <path
        v-for="l in stormOverlay.forecastLines" :key="l.key"
        :d="l.d" :stroke="l.stroke" :stroke-width="l.strokeWidth"
        :stroke-opacity="l.strokeOpacity" :stroke-dasharray="l.dash"
        stroke-linecap="round" stroke-linejoin="round" fill="none"
      />
      <!-- 实况点 -->
      <circle
        v-for="p in stormOverlay.actualPoints" :key="p.key"
        :cx="p.cx" :cy="p.cy" :r="p.r" :fill="p.fill"
        class="storm-hit"
        @mouseenter="onStormHover(true)"
        @mouseleave="onStormHover(false)"
        @click="onStormClick(p, $event)"
      />
      <!-- 预测点 -->
      <circle
        v-for="p in stormOverlay.forecastPoints" :key="p.key"
        :cx="p.cx" :cy="p.cy" :r="p.r" :fill="p.fill" :fill-opacity="p.fillOpacity"
        class="storm-hit"
        @mouseenter="onStormHover(true)"
        @mouseleave="onStormHover(false)"
        @click="onStormClick(p, $event)"
      />
      <!-- 当前活跃位置：SS/T/ST/VT 用 SVG 图标旋转，其他等级（D/S 等）用呼吸圆 -->
      <template v-for="p in stormOverlay.activeMarkers" :key="p.key">
        <image
          v-if="p.activeKind === 'rotate' && p.svgUrl"
          :href="p.svgUrl"
          :x="p.cx - p.r" :y="p.cy - p.r"
          :width="p.r * 2" :height="p.r * 2"
          class="storm-hit storm-active-svg"
          @mouseenter="onStormHover(true)"
          @mouseleave="onStormHover(false)"
          @click="onStormClick(p, $event)"
        />
        <circle
          v-else
          :cx="p.cx" :cy="p.cy" :r="p.r" :fill="p.fill"
          class="storm-hit storm-active-breath"
          @mouseenter="onStormHover(true)"
          @mouseleave="onStormHover(false)"
          @click="onStormClick(p, $event)"
        />
      </template>
    </svg>
  </div>
</template>

<style scoped>
.map-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
}
.map-container {
  width: 100%;
  height: 100%;
}
/* 台风 SVG overlay：浮在风力粒子 canvas 之上 */
.typhoon-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 4;
}
/* 只有可点击的圆点接收鼠标事件，path 和 svg 本身不阻挡地图交互 */
/* 所有圆点统一用白色描边 */
.typhoon-overlay .storm-hit {
  pointer-events: auto;
  cursor: pointer;
  stroke: rgba(255, 255, 255, 0.9);
  stroke-width: 1.5px;
}
.typhoon-overlay .storm-hit:hover {
  filter: drop-shadow(0 0 4px rgba(255, 255, 255, 0.8));
}
/* D/S 级别的活跃位置：呼吸放大缩小，描边更粗 */
.typhoon-overlay .storm-active-breath {
  transform-origin: center;
  transform-box: fill-box;
  animation: storm-breath 2.8s ease-in-out infinite;
  stroke-width: 2.5px;
}
/* SS/T/ST/VT/SU 级别的活跃位置：SVG 图标持续逆时针旋转 */
.typhoon-overlay .storm-active-svg {
  transform-origin: center;
  transform-box: fill-box;
  animation: storm-rotate 4s linear infinite reverse;
}
@keyframes storm-breath {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.15);
  }
}
@keyframes storm-rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
/* 将MapLibre的logo颜色反转以在黑色背景上可见 */
:deep(.maplibregl-ctrl-logo) {
  filter: invert(1) grayscale(1) brightness(1.5);
}
:deep(.maplibregl-ctrl-attrib a) {
  color: #fff; /* 让 attribution 文字也变成白色 */
}
:deep(.glow-index-popup .maplibregl-popup-content) {
  background: #1e1e1e;
  border-radius: 8px;
  padding: 0;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
}
:deep(.glow-index-popup .maplibregl-popup-tip) {
  border-top-color: #1e1e1e;
}
:deep(.glow-index-popup .maplibregl-popup-close-button) {
  color: #999;
  font-size: 18px;
  right: 6px;
  top: 4px;
}
:deep(.glow-index-popup .maplibregl-popup-close-button:hover) {
  color: #fff;
  background: transparent;
}
:deep(.storm-popup .maplibregl-popup-content) {
  background: #1e1e1e;
  border-radius: 8px;
  padding: 10px 14px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
}
:deep(.storm-popup) {
  z-index: 10;
}
/* 风场粒子 canvas 用 screen 混合，让下层 MapLibre 图层（实况/预测路线点位）视觉上不被遮挡 */
:deep(.wind-particles-canvas) {
  mix-blend-mode: screen;
}
:deep(.storm-popup .maplibregl-popup-tip) {
  border-top-color: #1e1e1e;
}
:deep(.storm-popup .maplibregl-popup-close-button) {
  color: #999;
  font-size: 16px;
  right: 6px;
  top: 4px;
}
:deep(.storm-popup .maplibregl-popup-close-button:hover) {
  color: #fff;
  background: transparent;
}
</style>
