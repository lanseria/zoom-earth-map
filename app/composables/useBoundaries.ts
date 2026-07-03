// app/composables/useBoundaries.ts
import type { Map } from 'maplibre-gl'

type MapGetter = () => Map

/**
 * 国界线 + 全球海岸线图层。
 * 注意：所有 raster 图层（温度/云量/卫星/火烧云）都以 `country-boundaries-outline-layer`
 * 作为 insert-before 参考，因此 boundaries 必须在它们之前最先加载。
 *
 * @param getMap 返回 map 实例的 getter（map 在 onMounted 才赋值，故用 getter 延迟读取）
 */
export function useBoundaries(getMap: MapGetter) {
  const timelineStore = useTimelineStore()

  /** 添加本地 GeoJSON 国界线图层 + 全球海岸线图层 */
  async function addBoundaries() {
    const map = getMap()
    try {
      map.addSource('local-boundaries-source', {
        type: 'geojson',
        data: '/api/proxy/boundaries.json',
      })

      const initialVisibility = timelineStore.showBoundaries ? 'visible' : 'none'

      // 0. 透明锚点图层：作为 raster 叠加层的分界线。
      //    卫星云图 insert-before 此锚点（始终在卫星之上、分析层之下），
      //    火烧云/温度/云量 insert-before 'country-boundaries-outline-layer'（在锚点之上），
      //    从而无需任何 moveLayer 即可保证图层顺序正确，各图层互不引用。
      map.addLayer({
        id: 'raster-overlay-anchor',
        type: 'line',
        source: 'local-boundaries-source',
        layout: { visibility: 'none' },
        paint: { 'line-opacity': 0 },
      })

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

  // --- 监听显隐开关 ---
  watch(() => timelineStore.showBoundaries, (isVisible) => {
    const map = getMap()
    const visibility = isVisible ? 'visible' : 'none'
    const layerIds = ['country-boundaries-outline-layer', 'country-boundaries-layer', 'global-coastline-layer']
    layerIds.forEach((id) => {
      if (map.getLayer(id))
        map.setLayoutProperty(id, 'visibility', visibility)
    })
  })

  return { addBoundaries }
}
