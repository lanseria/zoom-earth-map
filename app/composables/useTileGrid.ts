// app/composables/useTileGrid.ts
import type { GeoJSONSource, Map } from 'maplibre-gl'
import { SATELLITES } from '~/constants/map'

type MapGetter = () => Map

/** 贴图网格调试：显示当前视口内每个贴图的边界、坐标和所属卫星 */
export function useTileGrid(getMap: MapGetter) {
  const timelineStore = useTimelineStore()

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

  // NOTE: getSatelliteForLng 概念上也属于 satellite 系统，第二批拆 satellite 时
  // 可考虑挪到 ~/constants/map 与 SATELLITES 放在一起，届时改此处引用即可。
  function getSatelliteForLng(lng: number) {
    return SATELLITES.find(sat => lng >= sat.bounds[0] && lng < sat.bounds[2])
  }

  function tileGridUpdate() {
    const map = getMap()
    if (!map.isStyleLoaded())
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
      (map.getSource(sourceId) as GeoJSONSource).setData(geojson)
      for (const id of [lineLayerId, labelLayerId]) {
        if (map.getLayer(id))
          map.setLayoutProperty(id, 'visibility', 'visible')
      }
    }
  }

  // 视口移动后刷新网格
  const onMoveEnd = () => tileGridUpdate()

  /** 在 map 加载后调用：注册 moveend 监听 + 首次刷新网格 */
  function initTileGrid() {
    const map = getMap()
    map.on('moveend', onMoveEnd)
    tileGridUpdate()
  }

  watch(() => timelineStore.showTileGrid, () => tileGridUpdate())

  // 清理：移除 moveend 监听（修复原 onUnmounted 的遗漏）
  onScopeDispose(() => {
    const map = getMap()
    map.off('moveend', onMoveEnd)
  })

  return { tileGridUpdate, initTileGrid }
}
