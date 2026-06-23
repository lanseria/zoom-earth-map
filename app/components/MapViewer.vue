<script setup lang="ts">
import type { StormForecastBatch, StormTrack, StormTrackPoint } from '~/composables/timeline'
import type { BaseMapType } from '~/constants/map'
import type { WindData } from '~/utils/wind-particles'
import maplibregl from 'maplibre-gl'
import { createApp } from 'vue'
import GlowIndexPopup from '~/components/GlowIndexPopup.vue'
import { useTimelineStore } from '~/composables/timeline'
import { SATELLITES, unifiedStyle } from '~/constants/map'
import { WindParticleLayer } from '~/utils/wind-particles'
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
let previousTimestamp: number | null = null

// --- 台风图层配色与样式 ---
const STORM_COLOR_BY_CODE: Record<string, string> = {
  D: '#0a84ff', // 热带低压
  S: '#00f060', // 热带风暴
  1: '#ffcc00', // 强热带风暴
  SS: '#ffcc00', // Severe Tropical Storm（强热带风暴）
  2: '#ff9400', // 台风
  T: '#ff9400', // Typhoon（台风）
  3: '#ff5900', // 强台风
  ST: '#ff5900', // Very Strong Typhoon
  4: '#ff0022', // 超强台风（暴力台风）
  VT: '#ff0022', // Violent Typhoon（暴力台风）
  5: '#ff0022', // Cat 5
}
const STORM_COLOR_BY_SOURCE: Record<string, string> = {
  'zoom-earth': '#00b4d8',
  'cma': '#f87171',
  'jma': '#f4845f',
  'jtwc': '#a3e635',
  'cwa': '#60a5fa',
  'hko': '#fbbf24',
  'kma': '#a78bfa',
}
const STORM_ACTUAL_LINE_COLOR = '#fbbf24'
const STORM_SOURCE_FALLBACK = '#94a3b8'
// 统一的点位半径
const STORM_POINT_RADIUS = 5
const STORM_FORECAST_POINT_RADIUS = 4
const STORM_ACTIVE_MARKER_RADIUS = 8

function stormSourceColor(source: string) {
  return STORM_COLOR_BY_SOURCE[source] ?? STORM_SOURCE_FALLBACK
}

function stormPointColor(code: string) {
  return STORM_COLOR_BY_CODE[code] ?? STORM_SOURCE_FALLBACK
}

function formatStormDateBjt(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  })
}

// 每个预测 source 取 issued_at 最新的一批
function pickLatestForecastBatches(forecasts: StormForecastBatch[]): StormForecastBatch[] {
  const bySource = new Map<string, StormForecastBatch>()
  for (const b of forecasts) {
    const cur = bySource.get(b.source)
    if (!cur || new Date(b.issued_at) > new Date(cur.issued_at))
      bySource.set(b.source, b)
  }
  return [...bySource.values()]
}

function sortPointsByDate(points: StormTrackPoint[]): StormTrackPoint[] {
  return [...points].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
}

// --- 贴图网格调试工具 ---
function lng2tile(lng: number, z: number) {
  return Math.max(0, Math.min(Math.floor((lng + 180) / 360 * 2 ** z), 2 ** z - 1))
}

function lat2tile(lat: number, z: number) {
  return Math.max(0, Math.min(Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z), 2 ** z - 1))
}

function tile2lng(x: number, z: number) {
  return x / 2 ** z * 360 - 180
}

function tile2lat(y: number, z: number) {
  const n = Math.PI - 2 * Math.PI * y / 2 ** z
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

function getSatelliteForLng(lng: number) {
  return SATELLITES.find(sat => lng >= sat.bounds[0] && lng < sat.bounds[2])
}

/**
 * 更新底图图层的可见性
 * @param baseMapType 要显示的底图类型
 */
function updateBaseMapVisibility(baseMapType: BaseMapType) {
  if (!map || !map.isStyleLoaded())
    return

  const mapLayers: Record<string, string[]> = {
    vec: ['tdt-vec-layer', 'tdt-cva-layer'],
    img: ['tdt-img-layer', 'tdt-cia-layer'],
    ter: ['tdt-ter-layer', 'tdt-cta-layer'],
    dark: ['background'],
  }

  // 首先，隐藏所有可切换的底图和注记图层
  Object.values(mapLayers).flat().forEach((layerId) => {
    if (map.getLayer(layerId))
      map.setLayoutProperty(layerId, 'visibility', 'none')
  })

  // 然后，只显示当前选定的底图及其对应的注记图层
  const layersToShow = mapLayers[baseMapType]
  if (layersToShow) {
    layersToShow.forEach((layerId) => {
      if (map.getLayer(layerId))
        map.setLayoutProperty(layerId, 'visibility', 'visible')
    })
  }
}

onMounted(() => {
  if (!mapContainer.value)
    return
  map = markRaw(new maplibregl.Map({
    container: mapContainer.value,
    style: unifiedStyle,
    center: [120, 30],
    zoom: 5,
    minZoom: 3,
    maxZoom: 8,
    attributionControl: false,
    hash: true,
  }))

  map.on('load', () => {
    // 1. 设置初始底图可见性 (关键修正)
    // 此时可以保证地图样式已加载
    updateBaseMapVisibility(timelineStore.activeBaseMap)
    // 调用时，这些函数内部会读取 store 的初始状态来设置可见性
    addBoundaryLayer()
    addCityMarkersLayerWithZoomLevels()
    if (props.selectedTimestamp)
      updateSatelliteLayer(props.selectedTimestamp)
    if (timelineStore.showWind)
      updateWindLayer()
    // 台风图层：首次自动拉取已关注列表，等数据回来后再渲染
    if (timelineStore.showTyphoon) {
      updateTyphoonLayers()
      if (timelineStore.activeStorms.length === 0)
        timelineStore.fetchActiveStorms().finally(() => updateTyphoonLayers())
    }
    // 恢复存储的投影设置
    if (timelineStore.mapProjection === 'globe')
      map.setProjection({ type: 'globe' })
    // 初始化贴图网格
    tileGridUpdate()
    onMapZoom()
  })

  map.on('zoomend', onMapZoom)

  // 台风图层交互事件（一次性挂载）
  map.on('mousemove', handleStormMouseEnter)
  map.on('mouseout', handleStormMouseLeave)
  map.on('click', handleStormClick)

  map.on('error', (e) => {
    if (e && e.error)
      console.error('MapLibre Error:', e.error.message)
  })

  map.on('moveend', () => tileGridUpdate())

  // --- 火烧云图层点击查询 ---
  map.on('click', (e) => {
    if (!timelineStore.showChromaticSky || !timelineStore.chromaticSkySelection)
      return
    // 如果点到了城市图层，不触发火烧云查询
    const cityFeatures = map.queryRenderedFeatures(e.point, {
      layers: ['capitals-points', 'capitals-labels', 'other-cities-points', 'other-cities-labels'],
    })
    if (cityFeatures.length > 0)
      return

    const { lng, lat } = e.lngLat
    queryGlowIndex(lng, lat)
  })
})

/**
 * 新的城市标记图层函数，实现分级显示、Hover效果(圆点+文字)及点击跳转
 */
async function addCityMarkersLayerWithZoomLevels() {
  try {
    const response = await fetch('/new_data.json') // 加载新数据
    if (!response.ok)
      throw new Error(`HTTP error! status: ${response.status}`)
    const citiesData = await response.json()

    // 1. 将数据转换为 GeoJSON 格式，并添加 ID (必须用于 feature-state)
    const geojsonData: any = {
      type: 'FeatureCollection',
      features: citiesData.map((city: any, index: number) => ({
        type: 'Feature',
        id: index, // 添加唯一 ID
        geometry: {
          type: 'Point',
          coordinates: [city.lng, city.lat],
        },
        properties: {
          name: city.name,
          level: city.level,
        },
      })),
    }

    map.addSource('cities-source', {
      type: 'geojson',
      data: geojsonData,
    })

    const initialVisibility = timelineStore.showCities ? 'visible' : 'none'

    // 定义 Hover 时的颜色 (淡蓝色 #87CEFA) 和默认颜色 (#ffffff)
    const hoverColor = '#87CEFA'
    const defaultColor = '#ffffff'

    // MapLibre 样式表达式：根据 feature-state 的 hover 状态切换颜色
    const activeColorStyle = [
      'case',
      ['boolean', ['feature-state', 'hover'], false],
      hoverColor,
      defaultColor,
    ]

    // 2. 省会和直辖市图层 (level 1)，在 zoom >= 3 时显示
    map.addLayer({
      id: 'capitals-points',
      type: 'circle',
      source: 'cities-source',
      minzoom: 3,
      filter: ['==', 'level', 1],
      layout: { visibility: initialVisibility },
      paint: {
        'circle-radius': 4,
        'circle-color': activeColorStyle as any, // 应用动态颜色
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
        'visibility': initialVisibility,
        'text-field': ['get', 'name'],
        'text-size': 13,
        'text-offset': [0, -1.8],
        'text-anchor': 'top',
        'icon-allow-overlap': true,
        'text-font': ['Noto Sans Bold'],
      },
      paint: {
        'text-color': activeColorStyle as any, // 应用动态颜色
        'text-halo-color': '#333333',
        'text-halo-width': 1,
      },
    })

    // 3. 其他主要城市图层 (level 2)，在 zoom >= 5 时显示
    map.addLayer({
      id: 'other-cities-points',
      type: 'circle',
      source: 'cities-source',
      minzoom: 5,
      filter: ['==', 'level', 2],
      layout: { visibility: initialVisibility },
      paint: {
        'circle-radius': 3,
        'circle-color': activeColorStyle as any, // 应用动态颜色
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
        'visibility': initialVisibility,
        'text-field': ['get', 'name'],
        'text-size': 12,
        'text-offset': [0, -1.8],
        'text-anchor': 'top',
        'icon-allow-overlap': true,
        'text-font': ['DIN Pro Bold'],
      },
      paint: {
        'text-color': activeColorStyle as any, // 应用动态颜色
        'text-halo-color': '#333333',
        'text-halo-width': 0.9,
      },
    })

    // --- 交互逻辑 (Hover & Click) ---
    // 包含圆点层和文字层，这样悬停文字时圆点也会变色，反之亦然
    const interactionLayers = ['capitals-points', 'capitals-labels', 'other-cities-points', 'other-cities-labels']
    let hoveredStateId: string | number | null = null

    // 鼠标移动事件：处理 Hover 样式
    map.on('mousemove', (e) => {
      // 检查鼠标下是否有我们在意的图层特性
      const features = map.queryRenderedFeatures(e.point, { layers: interactionLayers })

      if (features.length > 0) {
        map.getCanvas().style.cursor = 'pointer'
        const feature = features[0]!
        const id = feature.id

        if (id !== undefined && id !== hoveredStateId) {
          // 清除之前的 hover
          if (hoveredStateId !== null) {
            map.setFeatureState(
              { source: 'cities-source', id: hoveredStateId },
              { hover: false },
            )
          }
          // 设置新的 hover
          hoveredStateId = id
          map.setFeatureState(
            { source: 'cities-source', id: hoveredStateId },
            { hover: true },
          )
        }
      }
      else {
        // 移出有效区域但仍在地图上移动时
        map.getCanvas().style.cursor = ''
        if (hoveredStateId !== null) {
          map.setFeatureState(
            { source: 'cities-source', id: hoveredStateId },
            { hover: false },
          )
          hoveredStateId = null
        }
      }
    })

    // 鼠标彻底移出地图容器
    map.on('mouseleave', () => {
      map.getCanvas().style.cursor = ''
      if (hoveredStateId !== null) {
        map.setFeatureState(
          { source: 'cities-source', id: hoveredStateId },
          { hover: false },
        )
        hoveredStateId = null
      }
    })

    // 点击事件：跳转链接
    map.on('click', interactionLayers, (e) => {
      if (!e.features || e.features.length === 0)
        return

      const feature = e.features[0]!
      const geometry = feature.geometry as any
      const props = feature.properties

      // 确保是点几何类型
      if (geometry.type === 'Point') {
        const [lon, lat] = geometry.coordinates
        const name = props?.name || ''

        const url = `http://bmcr1-wtr-r1:3030/?lat=${lat}&lon=${lon}&name=${name}`
        window.open(url, '_blank')
      }
    })
  }
  catch (error) {
    console.error('加载城市数据失败:', error)
  }
}

/**
 * 添加本地 GeoJSON 国界线图层 + 全球陆地线图层
 */
async function addBoundaryLayer() {
  try {
    map.addSource('local-boundaries-source', {
      type: 'geojson',
      data: '/api/proxy/boundaries.json',
    })

    const initialVisibility = timelineStore.showBoundaries ? 'visible' : 'none'

    // 1. 添加底层轮廓线
    map.addLayer({
      id: 'country-boundaries-outline-layer',
      type: 'line',
      source: 'local-boundaries-source',
      layout: { visibility: initialVisibility },
      paint: {
        'line-color': '#333333',
        'line-width': 3,
        'line-opacity': 0.6,
      },
    })

    // 2. 添加上层主线
    map.addLayer({
      id: 'country-boundaries-layer',
      type: 'line',
      source: 'local-boundaries-source',
      layout: { visibility: initialVisibility },
      paint: {
        'line-color': '#ffffff',
        'line-width': 1,
        'line-opacity': 0.8,
      },
    })

    // 3. 全球海岸线（不含中国）
    map.addSource('global-coastline-source', {
      type: 'geojson',
      data: '/assets/ne_50m_coastline_without_china.geojson',
    })

    map.addLayer({
      id: 'global-coastline-layer',
      type: 'line',
      source: 'global-coastline-source',
      layout: { visibility: initialVisibility },
      paint: {
        'line-color': '#eeeeee',
        'line-width': 2,
        'line-opacity': 0.5,
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
// 监听 activeBaseMap 的变化
watch(() => timelineStore.activeBaseMap, (newBaseMap) => {
  updateBaseMapVisibility(newBaseMap)
})

// --- 监听图层显隐开关 ---
watch(() => timelineStore.showBoundaries, (isVisible) => {
  if (!map)
    return
  const visibility = isVisible ? 'visible' : 'none'
  const layerIds = ['country-boundaries-outline-layer', 'country-boundaries-layer', 'global-land-outline-layer', 'global-land-layer']
  layerIds.forEach((id) => {
    if (map.getLayer(id))
      map.setLayoutProperty(id, 'visibility', visibility)
  })
})

watch(() => timelineStore.showCities, (isVisible) => {
  if (!map)
    return
  const visibility = isVisible ? 'visible' : 'none'
  const layerIds = ['capitals-points', 'capitals-labels', 'other-cities-points', 'other-cities-labels']
  layerIds.forEach((id) => {
    if (map.getLayer(id))
      map.setLayoutProperty(id, 'visibility', visibility)
  })
})

watch(() => timelineStore.showTileGrid, () => tileGridUpdate())

// --- 监听卫星云图可见性变化 ---
function updateSatelliteCloudVisibility() {
  if (!map || !map.isStyleLoaded())
    return

  const showAll = timelineStore.showSatelliteCloud
  const satVis = timelineStore.satelliteVisibility

  for (const sat of SATELLITES) {
    const visible = showAll && satVis[sat.id]
    const visibility = visible ? 'visible' : 'none'
    // 遍历地图中所有图层，匹配该卫星的图层
    const style = map.getStyle()
    for (const layer of style.layers) {
      if (layer.id.startsWith(`satellite-${sat.id}-layer-`)) {
        map.setLayoutProperty(layer.id, 'visibility', visibility)
      }
    }
  }
}

watch(() => [timelineStore.showSatelliteCloud, timelineStore.satelliteVisibility] as const, () => {
  updateSatelliteCloudVisibility()
}, { deep: true })

// --- 火烧云图层 ---
const CHROMATIC_SKY_SOURCE_ID = 'chromatic-sky-source'
const CHROMATIC_SKY_LAYER_ID = 'chromatic-sky-layer'

let glowIndexPopup: maplibregl.Popup | null = null
let glowIndexApp: ReturnType<typeof createApp> | null = null

function closeGlowIndexPopup() {
  if (glowIndexApp) {
    glowIndexApp.unmount()
    glowIndexApp = null
  }
  if (glowIndexPopup) {
    glowIndexPopup.remove()
    glowIndexPopup = null
  }
}

function mountPopupComponent(props: { data: any, error: string | null }): HTMLDivElement {
  const el = document.createElement('div')
  glowIndexApp = createApp(GlowIndexPopup, props)
  glowIndexApp.mount(el)
  return el
}

async function queryGlowIndex(lng: number, lat: number) {
  const sel = timelineStore.chromaticSkySelection
  if (!sel)
    return

  const [year, month, day] = [sel.date.slice(0, 4), sel.date.slice(4, 6), sel.date.slice(6, 8)]
  const dateStr = `${year}-${month}-${day}`
  const apiUrl = `http://bmcr1-wtr-r1:8002/api/glow-index?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}&event=${sel.event}&date=${dateStr}`

  // 加载中 popup
  closeGlowIndexPopup()
  glowIndexPopup = new maplibregl.Popup({ closeButton: true, maxWidth: '280px', className: 'glow-index-popup' })
    .setLngLat([lng, lat])
    .setDOMContent(mountPopupComponent({ data: null, error: null }))
    .addTo(map!)

  try {
    const data = await $fetch<{
      lat: number
      lon: number
      date: string
      event: string
      event_time: string
      data_time: string
      final_score: number
      score_boundary: number
      score_hcc: number
      score_mcc: number
      score_lcc: number
      score_aod550: number
    }>(apiUrl)

    glowIndexPopup!.setDOMContent(mountPopupComponent({ data, error: null }))
  }
  catch (err: any) {
    const msg = err?.data?.detail || err?.message || '查询失败'
    glowIndexPopup!.setDOMContent(mountPopupComponent({ data: null, error: msg }))
  }
}

function updateChromaticSkyLayer() {
  if (!map)
    return
  // style 还在过渡态时排队等下一个 idle 重试，避免首次刷新漏渲染
  if (!map.isStyleLoaded()) {
    map.once('idle', updateChromaticSkyLayer)
    return
  }

  const sel = timelineStore.chromaticSkySelection

  // 移除旧图层
  if (map.getLayer(CHROMATIC_SKY_LAYER_ID))
    map.removeLayer(CHROMATIC_SKY_LAYER_ID)
  if (map.getSource(CHROMATIC_SKY_SOURCE_ID))
    map.removeSource(CHROMATIC_SKY_SOURCE_ID)

  if (!sel || !timelineStore.showChromaticSky)
    return

  // 直接使用 serverUrl
  const tileUrl = `${props.serverUrl}/chroma-sky-tiles/{z}/{x}/{y}/${sel.date}-${sel.event}.png`

  map.addSource(CHROMATIC_SKY_SOURCE_ID, {
    type: 'raster',
    tiles: [tileUrl],
    tileSize: 256,
    maxzoom: 7,
  })

  map.addLayer({
    id: CHROMATIC_SKY_LAYER_ID,
    type: 'raster',
    source: CHROMATIC_SKY_SOURCE_ID,
    paint: {
      'raster-opacity': 0.8,
    },
  }, 'country-boundaries-outline-layer')
}

watch(() => [timelineStore.chromaticSkySelection, timelineStore.showChromaticSky] as const, () => {
  updateChromaticSkyLayer()
}, { deep: true })

// --- 风力粒子图层 ---
let windParticleLayer: WindParticleLayer | null = null
let windLayerGen = 0

async function updateWindLayer() {
  const gen = ++windLayerGen

  if (!map)
    return

  if (!timelineStore.showWind) {
    destroyWindLayer()
    return
  }

  await timelineStore.fetchWindManifests(props.serverUrl)
  if (gen !== windLayerGen)
    return

  const windTs = timelineStore.selectedWindTimestamp
  if (!windTs) {
    destroyWindLayer()
    return
  }

  try {
    const url = `${props.serverUrl}/wind-tiles/850hPa/particle/${windTs}.json`
    const data = await $fetch<WindData>(url)
    if (gen !== windLayerGen)
      return
    destroyWindLayer()
    windParticleLayer = new WindParticleLayer(map, data, timelineStore.windOptions)
  }
  catch (e) {
    console.error('加载风力粒子数据失败:', e)
  }
}

function destroyWindLayer() {
  if (windParticleLayer) {
    windParticleLayer.destroy()
    windParticleLayer = null
  }
}

watch(() => timelineStore.showWind, () => updateWindLayer())
watch(() => timelineStore.selectedWindTimestamp, () => updateWindLayer())
watch(() => timelineStore.windOptions, (opts) => {
  windParticleLayer?.updateOptions(opts)
}, { deep: true })

// --- 台风图层 ---
const STORM_LAYER_IDS = [
  'typhoon-actual-line',
  'typhoon-actual-points',
  'typhoon-forecast-line',
  'typhoon-forecast-points',
  'typhoon-active-marker',
]
const STORM_SOURCE_IDS = [
  'typhoon-actual-line-source',
  'typhoon-actual-points-source',
  'typhoon-forecast-line-source',
  'typhoon-forecast-points-source',
  'typhoon-active-marker-source',
]
let stormPopup: maplibregl.Popup | null = null

function removeTyphoonLayers() {
  if (!map)
    return
  for (const id of STORM_LAYER_IDS) {
    if (map.getLayer(id))
      map.removeLayer(id)
  }
  for (const id of STORM_SOURCE_IDS) {
    if (map.getSource(id))
      map.removeSource(id)
  }
  if (stormPopup) {
    stormPopup.remove()
    stormPopup = null
  }
}

function buildStormGeoJSON() {
  const visibleStorms = timelineStore.activeStorms
    .filter(s => s.kind === 'storm'
      && (timelineStore.stormVisibility[s.id] ?? true)
      && timelineStore.stormTracks[s.id])

  const actualLineFeatures: any[] = []
  const actualPointFeatures: any[] = []
  const forecastLineFeatures: any[] = []
  const forecastPointFeatures: any[] = []
  const activeMarkerFeatures: any[] = []

  for (const storm of visibleStorms) {
    const track = timelineStore.stormTracks[storm.id]!
    const name = track.info.name
    const history = sortPointsByDate(track.track_history)
    // 实况线
    if (history.length >= 2) {
      actualLineFeatures.push({
        type: 'Feature',
        properties: { storm_id: storm.id, name, kind: 'actual' },
        geometry: { type: 'LineString', coordinates: history.map(p => [p.lng, p.lat]) },
      })
    }
    // 实况点
    for (const p of history) {
      actualPointFeatures.push({
        type: 'Feature',
        properties: {
          storm_id: storm.id,
          name,
          date: p.date,
          wind: p.wind,
          pressure: p.pressure,
          code: p.code,
          description: p.description,
          source: p.source ?? 'zoom-earth',
          kind: 'actual',
        },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      })
    }
    // 最新实况点 → active marker
    const latest = history.at(-1)
    if (latest) {
      activeMarkerFeatures.push({
        type: 'Feature',
        properties: {
          storm_id: storm.id,
          name,
          date: latest.date,
          wind: latest.wind,
          pressure: latest.pressure,
          code: latest.code,
          description: latest.description,
          source: latest.source ?? 'zoom-earth',
        },
        geometry: { type: 'Point', coordinates: [latest.lng, latest.lat] },
      })
    }
    // 预测（按 source 取最新一批；仅渲染已开启的预测机构）
    for (const batch of pickLatestForecastBatches(track.forecasts)) {
      if (!timelineStore.stormForecastSources[batch.source])
        continue
      const sorted = sortPointsByDate(batch.points)
      if (sorted.length === 0)
        continue
      // 把当前最新实况点接到预测线开头，避免预测线和实况断开
      const lineCoords: number[][] = []
      if (latest)
        lineCoords.push([latest.lng, latest.lat])
      for (const p of sorted)
        lineCoords.push([p.lng, p.lat])
      if (lineCoords.length >= 2) {
        forecastLineFeatures.push({
          type: 'Feature',
          properties: {
            storm_id: storm.id,
            name,
            source: batch.source,
            issued_at: batch.issued_at,
            kind: 'forecast',
          },
          geometry: { type: 'LineString', coordinates: lineCoords },
        })
      }
      for (const p of sorted) {
        forecastPointFeatures.push({
          type: 'Feature',
          properties: {
            storm_id: storm.id,
            name,
            date: p.date,
            wind: p.wind,
            pressure: p.pressure,
            code: p.code,
            description: p.description,
            source: batch.source,
            issued_at: batch.issued_at,
            kind: 'forecast',
          },
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        })
      }
    }
  }

  return {
    actualLine: { type: 'FeatureCollection' as const, features: actualLineFeatures },
    actualPoints: { type: 'FeatureCollection' as const, features: actualPointFeatures },
    forecastLine: { type: 'FeatureCollection' as const, features: forecastLineFeatures },
    forecastPoints: { type: 'FeatureCollection' as const, features: forecastPointFeatures },
    activeMarker: { type: 'FeatureCollection' as const, features: activeMarkerFeatures },
  }
}

function stormPointPopupHtml(props: any): string {
  const windMs = (props.wind * 1.852).toFixed(1)
  const sourceLabel = props.source ?? 'unknown'
  const issued = props.issued_at
    ? `<div style="color:#9ca3af">发布: ${formatStormDateBjt(props.issued_at)} (${props.source})</div>`
    : `<div style="color:#9ca3af">来源: ${sourceLabel}</div>`
  return `
    <div style="font-family: 'DM Sans', sans-serif; min-width: 180px; padding: 4px 2px;">
      <div style="font-size: 14px; font-weight: 600; color: #fff; margin-bottom: 4px;">${props.name}</div>
      <div style="font-size: 12px; color: #d1d5db; line-height: 1.6;">
        <div>时刻: ${formatStormDateBjt(props.date)} BJT</div>
        <div>位置: ${Number(props.lng ?? 0).toFixed(1)}°E, ${Number(props.lat ?? 0).toFixed(1)}°N</div>
        <div>风速: ${props.wind} kt (${windMs} m/s)</div>
        <div>气压: ${props.pressure} hPa</div>
        <div>等级: ${props.code} - ${props.description}</div>
        ${issued}
      </div>
    </div>
  `
}

function updateTyphoonLayers() {
  if (!map)
    return
  // style 还在过渡态时排队等下一个 idle 重试，避免首次刷新漏渲染
  if (!map.isStyleLoaded()) {
    map.once('idle', updateTyphoonLayers)
    return
  }

  removeTyphoonLayers()

  if (!timelineStore.showTyphoon)
    return

  const geojson = buildStormGeoJSON()

  // 实况线
  map.addSource('typhoon-actual-line-source', { type: 'geojson', data: geojson.actualLine as any })
  map.addLayer({
    id: 'typhoon-actual-line',
    type: 'line',
    source: 'typhoon-actual-line-source',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': STORM_ACTUAL_LINE_COLOR,
      'line-width': 3,
      'line-opacity': 0.9,
    },
  }, 'country-boundaries-outline-layer')

  // 实况点
  map.addSource('typhoon-actual-points-source', { type: 'geojson', data: geojson.actualPoints as any })
  map.addLayer({
    id: 'typhoon-actual-points',
    type: 'circle',
    source: 'typhoon-actual-points-source',
    paint: {
      'circle-radius': STORM_POINT_RADIUS,
      'circle-color': ['match', ['get', 'code'], 'D', STORM_COLOR_BY_CODE.D!, 'S', STORM_COLOR_BY_CODE.S!, '1', STORM_COLOR_BY_CODE['1']!, 'SS', STORM_COLOR_BY_CODE.SS!, '2', STORM_COLOR_BY_CODE['2']!, 'T', STORM_COLOR_BY_CODE.T!, '3', STORM_COLOR_BY_CODE['3']!, 'VT', STORM_COLOR_BY_CODE.VT!, '4', STORM_COLOR_BY_CODE['4']!, '5', STORM_COLOR_BY_CODE['5']!, 'ST', STORM_COLOR_BY_CODE.ST!, STORM_SOURCE_FALLBACK],
    },
  })

  // 预测线（按 source 着色 + 虚线）
  map.addSource('typhoon-forecast-line-source', { type: 'geojson', data: geojson.forecastLine as any })
  map.addLayer({
    id: 'typhoon-forecast-line',
    type: 'line',
    source: 'typhoon-forecast-line-source',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['match', ['get', 'source'], 'zoom-earth', STORM_COLOR_BY_SOURCE['zoom-earth']!, 'cma', STORM_COLOR_BY_SOURCE.cma!, 'jma', STORM_COLOR_BY_SOURCE.jma!, 'jtwc', STORM_COLOR_BY_SOURCE.jtwc!, 'cwa', STORM_COLOR_BY_SOURCE.cwa!, 'hko', STORM_COLOR_BY_SOURCE.hko!, 'kma', STORM_COLOR_BY_SOURCE.kma!, STORM_SOURCE_FALLBACK],
      'line-width': 2,
      'line-opacity': 0.85,
      'line-dasharray': [2, 2],
    },
  })

  // 预测点
  map.addSource('typhoon-forecast-points-source', { type: 'geojson', data: geojson.forecastPoints as any })
  map.addLayer({
    id: 'typhoon-forecast-points',
    type: 'circle',
    source: 'typhoon-forecast-points-source',
    paint: {
      'circle-radius': STORM_FORECAST_POINT_RADIUS,
      'circle-color': ['match', ['get', 'source'], 'zoom-earth', STORM_COLOR_BY_SOURCE['zoom-earth']!, 'cma', STORM_COLOR_BY_SOURCE.cma!, 'jma', STORM_COLOR_BY_SOURCE.jma!, 'jtwc', STORM_COLOR_BY_SOURCE.jtwc!, 'cwa', STORM_COLOR_BY_SOURCE.cwa!, 'hko', STORM_COLOR_BY_SOURCE.hko!, 'kma', STORM_COLOR_BY_SOURCE.kma!, STORM_SOURCE_FALLBACK],
      'circle-opacity': 0.95,
    },
  })

  // 当前活跃位置大圆
  map.addSource('typhoon-active-marker-source', { type: 'geojson', data: geojson.activeMarker as any })
  map.addLayer({
    id: 'typhoon-active-marker',
    type: 'circle',
    source: 'typhoon-active-marker-source',
    paint: {
      'circle-radius': STORM_ACTIVE_MARKER_RADIUS,
      'circle-color': ['match', ['get', 'code'], 'D', STORM_COLOR_BY_CODE.D!, 'S', STORM_COLOR_BY_CODE.S!, '1', STORM_COLOR_BY_CODE['1']!, 'SS', STORM_COLOR_BY_CODE.SS!, '2', STORM_COLOR_BY_CODE['2']!, 'T', STORM_COLOR_BY_CODE.T!, '3', STORM_COLOR_BY_CODE['3']!, 'VT', STORM_COLOR_BY_CODE.VT!, '4', STORM_COLOR_BY_CODE['4']!, '5', STORM_COLOR_BY_CODE['5']!, 'ST', STORM_COLOR_BY_CODE.ST!, STORM_ACTUAL_LINE_COLOR],
      'circle-opacity': 1,
    },
  })

  // Popup 交互（事件在 onMounted 中挂载一次，handler 内按 layer id 过滤）
}

const STORM_POPUP_LAYER_SET = new Set([
  'typhoon-actual-points',
  'typhoon-forecast-points',
  'typhoon-active-marker',
])

function handleStormMouseEnter(e: maplibregl.MapMouseEvent) {
  if (!map)
    return
  const features = map.queryRenderedFeatures(e.point, { layers: [...STORM_POPUP_LAYER_SET] })
  map.getCanvas().style.cursor = features.length > 0 ? 'pointer' : ''
}

function handleStormMouseLeave() {
  if (map)
    map.getCanvas().style.cursor = ''
}

function handleStormClick(e: maplibregl.MapMouseEvent) {
  if (!map)
    return
  const features = map.queryRenderedFeatures(e.point, { layers: [...STORM_POPUP_LAYER_SET] })
  if (features.length === 0)
    return
  const f = features[0]!
  const geom = f.geometry as any
  const coords = geom && geom.type === 'Point' ? geom.coordinates : [e.lngLat.lng, e.lngLat.lat]
  const props = { ...f.properties, lng: coords[0], lat: coords[1] }
  if (stormPopup)
    stormPopup.remove()
  stormPopup = new maplibregl.Popup({ closeButton: true, maxWidth: '260px', className: 'storm-popup' })
    .setLngLat(coords as [number, number])
    .setHTML(stormPointPopupHtml(props))
    .addTo(map)
}

watch(() => timelineStore.showTyphoon, () => updateTyphoonLayers())
watch(() => timelineStore.stormTracksFetchedAt, () => updateTyphoonLayers())
watch(() => timelineStore.stormTracks, () => updateTyphoonLayers(), { deep: true })
watch(() => timelineStore.stormVisibility, () => updateTyphoonLayers(), { deep: true })
watch(() => timelineStore.stormForecastSources, () => updateTyphoonLayers(), { deep: true })

function onMapZoom() {
  if (map)
    timelineStore.windCurrentZoom = Math.round(map.getZoom())
}

/**
 * 贴图网格调试：显示当前视口内每个贴图的边界、x/y/z 坐标和卫星 ID
 */
function tileGridUpdate() {
  if (!map || !map.isStyleLoaded())
    return

  const sourceId = 'tile-grid-source'
  const lineLayerId = 'tile-grid-lines'
  const labelLayerId = 'tile-grid-labels'

  // 隐藏网格
  if (!timelineStore.showTileGrid) {
    for (const id of [lineLayerId, labelLayerId]) {
      if (map.getLayer(id))
        map.setLayoutProperty(id, 'visibility', 'none')
    }
    return
  }

  const z = Math.min(Math.floor(map.getZoom()), 7)
  const bounds = map.getBounds()
  const maxTile = 2 ** z - 1
  const x1 = lng2tile(bounds.getWest(), z)
  const x2 = Math.min(lng2tile(bounds.getEast(), z), maxTile)
  const y1 = lat2tile(bounds.getNorth(), z)
  const y2 = Math.min(lat2tile(bounds.getSouth(), z), maxTile)

  // 防止贴图数量过多
  if ((x2 - x1 + 1) * (y2 - y1 + 1) > 200)
    return

  const features: any[] = []
  for (let tx = x1; tx <= x2; tx++) {
    for (let ty = y1; ty <= y2; ty++) {
      const lng1 = tile2lng(tx, z)
      const lng2 = tile2lng(tx + 1, z)
      const lat1 = tile2lat(ty, z)
      const lat2 = tile2lat(ty + 1, z)
      const sat = getSatelliteForLng((lng1 + lng2) / 2)

      // 网格线 (Polygon)
      features.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [[[lng1, lat1], [lng2, lat1], [lng2, lat2], [lng1, lat2], [lng1, lat1]]] },
      })
      // 标签 (Point)
      features.push({
        type: 'Feature',
        properties: { label: `${sat?.id ?? '?'}\n${tx}/${ty}/${z}` },
        geometry: { type: 'Point', coordinates: [(lng1 + lng2) / 2, (lat1 + lat2) / 2] },
      })
    }
  }

  const geojson = { type: 'FeatureCollection' as const, features }

  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, { type: 'geojson', data: geojson })
    map.addLayer({
      id: lineLayerId,
      type: 'line',
      source: sourceId,
      filter: ['==', ['geometry-type'], 'Polygon'],
      layout: { visibility: 'visible' },
      paint: { 'line-color': '#00ff00', 'line-width': 1, 'line-opacity': 0.7 },
    })
    map.addLayer({
      id: labelLayerId,
      type: 'symbol',
      source: sourceId,
      filter: ['==', ['geometry-type'], 'Point'],
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 10,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-font': ['DIN Pro Bold'],
      },
      paint: {
        'text-color': '#00ff00',
        'text-halo-color': 'rgba(0,0,0,0.8)',
        'text-halo-width': 1.5,
      },
    })
  }
  else {
    (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(geojson)
    for (const id of [lineLayerId, labelLayerId]) {
      if (map.getLayer(id))
        map.setLayoutProperty(id, 'visibility', 'visible')
    }
  }
}

/**
 * 获取指定时间戳下所有卫星的 source/layer ID
 */
function getSatelliteLayerIds(timestamp: number) {
  return SATELLITES.map(sat => ({
    sourceId: `satellite-${sat.id}-source-${timestamp}`,
    layerId: `satellite-${sat.id}-layer-${timestamp}`,
    bounds: sat.bounds,
    url: `${props.serverUrl}/zoom-earth-tiles/${sat.id}/{z}/{y}/{x}/${timestamp}.jpg`,
  }))
}

/**
 * 移除指定时间戳的所有卫星图层和源
 */
function removeSatelliteLayers(timestamp: number) {
  if (!map)
    return
  for (const { sourceId, layerId } of getSatelliteLayerIds(timestamp)) {
    if (map.getLayer(layerId))
      map.removeLayer(layerId)
    if (map.getSource(sourceId))
      map.removeSource(sourceId)
  }
}

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
    const satelliteIds = getSatelliteLayerIds(timestamp)

    // 检查是否已添加（检查第一个卫星的 source）
    if (map.getSource(satelliteIds[0]!.sourceId)) {
      // 已加载，恢复可见性
      for (const { layerId } of satelliteIds) {
        if (map.getLayer(layerId))
          map.setPaintProperty(layerId, 'raster-opacity', 1)
      }
      // 淡出上一个时间戳
      if (previousTimestamp !== null && previousTimestamp !== timestamp) {
        for (const { layerId } of getSatelliteLayerIds(previousTimestamp)) {
          if (map.getLayer(layerId))
            map.setPaintProperty(layerId, 'raster-opacity', 0)
        }
      }
      previousTimestamp = timestamp
      resolve()
      return
    }

    // 为每颗卫星添加 source 和 layer
    for (let i = 0; i < satelliteIds.length; i++) {
      const { sourceId, layerId, bounds, url } = satelliteIds[i]!
      const satId = SATELLITES[i]!.id
      const visible = timelineStore.showSatelliteCloud && timelineStore.satelliteVisibility[satId]

      map.addSource(sourceId, {
        type: 'raster',
        tiles: [url],
        tileSize: 256,
        bounds,
        maxzoom: 7,
      })

      map.addLayer({
        id: layerId,
        type: 'raster',
        source: sourceId,
        layout: { visibility: visible ? 'visible' : 'none' },
        paint: {
          'raster-fade-duration': FADE_DURATION,
          'raster-opacity': 1,
        },
      }, 'country-boundaries-outline-layer')
    }

    // 确保火烧云图层始终在卫星云图之上
    if (map.getLayer(CHROMATIC_SKY_LAYER_ID))
      map.moveLayer(CHROMATIC_SKY_LAYER_ID, 'country-boundaries-outline-layer')

    // 等待第一个卫星源加载完成后清理旧图层
    const onSourceData = (e: any) => {
      if (e.sourceId === satelliteIds[0]!.sourceId && e.isSourceLoaded) {
        map.off('sourcedata', onSourceData)
        if (previousTimestamp !== null && previousTimestamp !== timestamp) {
          const oldTimestamp = previousTimestamp
          setTimeout(removeSatelliteLayers, FADE_DURATION + 100, oldTimestamp)
        }
        previousTimestamp = timestamp
        resolve()
      }
    }
    map.on('sourcedata', onSourceData)
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
  closeGlowIndexPopup()
  destroyWindLayer()
  removeTyphoonLayers()
  if (map) {
    map.off('mousemove', handleStormMouseEnter)
    map.off('mouseout', handleStormMouseLeave)
    map.off('click', handleStormClick)
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
