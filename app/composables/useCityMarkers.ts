// app/composables/useCityMarkers.ts
import type { Map } from 'maplibre-gl'

type MapGetter = () => Map

/** 城市标记图层：分级显示（省会/主要城市）+ Hover 高亮 + 点击跳转详情页 */
export function useCityMarkers(getMap: MapGetter, ctx: { cityDetailUrl: string }) {
  const timelineStore = useTimelineStore()
  const { cityDetailUrl } = ctx

  // 事件 handler 提到外层以便 onScopeDispose 解绑（MapLibre 的 off 需要同一函数引用）
  const interactionLayers = ['capitals-points', 'capitals-labels', 'other-cities-points', 'other-cities-labels']
  let hoveredStateId: string | number | null = null
  let onMove: ((e: any) => void) | null = null
  let onLeave: (() => void) | null = null
  let onCityClick: ((e: any) => void) | null = null

  /** 添加城市标记图层（含 Hover / Click 交互） */
  async function addCityMarkers() {
    const map = getMap()
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

      // 鼠标移动事件：处理 Hover 样式
      onMove = (e: any) => {
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
      }
      map.on('mousemove', onMove)

      // 鼠标彻底移出地图容器
      onLeave = () => {
        map.getCanvas().style.cursor = ''
        if (hoveredStateId !== null) {
          map.setFeatureState(
            { source: 'cities-source', id: hoveredStateId },
            { hover: false },
          )
          hoveredStateId = null
        }
      }
      map.on('mouseleave', onLeave)

      // 点击事件：跳转链接
      onCityClick = (e: any) => {
        if (!e.features || e.features.length === 0)
          return

        const feature = e.features[0]!
        const geometry = feature.geometry as any
        const props = feature.properties

        // 确保是点几何类型
        if (geometry.type === 'Point') {
          const [lon, lat] = geometry.coordinates
          const name = props?.name || ''

          // 未配置详情页地址时跳过跳转
          if (!cityDetailUrl)
            return

          const url = `${cityDetailUrl}?lat=${lat}&lon=${lon}&name=${name}`
          window.open(url, '_blank')
        }
      }
      map.on('click', interactionLayers, onCityClick)
    }
    catch (error) {
      console.error('加载城市数据失败:', error)
    }
  }

  // --- 监听显隐开关 ---
  watch(() => timelineStore.showCities, (isVisible) => {
    const map = getMap()
    const visibility = isVisible ? 'visible' : 'none'
    interactionLayers.forEach((id) => {
      if (map.getLayer(id))
        map.setLayoutProperty(id, 'visibility', visibility)
    })
  })

  // 清理：移除事件监听（修复原 onUnmounted 的遗漏）
  onScopeDispose(() => {
    const map = getMap()
    if (onMove)
      map.off('mousemove', onMove)
    if (onLeave)
      map.off('mouseleave', onLeave)
    if (onCityClick)
      map.off('click', interactionLayers, onCityClick)
  })

  return { addCityMarkers }
}
