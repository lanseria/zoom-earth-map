// app/composables/useSatelliteTiles.ts
import type { Map } from 'maplibre-gl'
import { SATELLITES } from '~/constants/map'

type MapGetter = () => Map

/** 卫星云图 raster 图层（按时间戳切换，支持淡入淡出） */
export function useSatelliteTiles(
  getMap: MapGetter,
  ctx: {
    serverUrl: string
    animationStyle: string
    /** 当前选中的时间戳 getter（来自父组件 props.selectedTimestamp） */
    selectedTimestamp: () => number
  },
) {
  const timelineStore = useTimelineStore()
  const { serverUrl, animationStyle, selectedTimestamp } = ctx

  // 用于淡出上一个时间戳
  let previousTimestamp: number | null = null

  /** 获取指定时间戳下所有卫星的 source/layer ID */
  function getSatelliteLayerIds(timestamp: number) {
    return SATELLITES.map(sat => ({
      sourceId: `satellite-${sat.id}-source-${timestamp}`,
      layerId: `satellite-${sat.id}-layer-${timestamp}`,
      bounds: sat.bounds,
      url: `${serverUrl}/zoom-earth-tiles/${sat.id}/{z}/{y}/{x}/${timestamp}.jpg`,
    }))
  }

  /** 移除指定时间戳的所有卫星图层和源 */
  function removeSatelliteLayers(timestamp: number) {
    const map = getMap()
    for (const { sourceId, layerId } of getSatelliteLayerIds(timestamp)) {
      if (map.getLayer(layerId))
        map.removeLayer(layerId)
      if (map.getSource(sourceId))
        map.removeSource(sourceId)
    }
  }

  function updateSatelliteLayer(timestamp: number): Promise<void> {
    const map = getMap()
    return new Promise((resolve) => {
      if (!timestamp) {
        resolve()
        return
      }

      const FADE_DURATION = animationStyle === 'fast' ? 500 : 0
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
      // 注意：insert-before 'raster-overlay-anchor' 让卫星始终位于锚点之下，
      //       从而保证它在火烧云/温度/云量（锚点之上）的下方，无需任何 moveLayer。
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
        }, 'raster-overlay-anchor')
      }

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

  function updateSatelliteCloudVisibility() {
    const map = getMap()
    if (!map.isStyleLoaded())
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

  // 监听 selectedTimestamp 的变化, 仅在非播放状态下生效
  // 这个 watch 只处理手动拖动或点击时间轴的情况；播放时的更新由父组件 store 主动调用 updateSatelliteLayer
  watch(selectedTimestamp, (newTimestamp, oldTimestamp) => {
    const map = getMap()
    if (map.isStyleLoaded() && newTimestamp !== oldTimestamp)
      updateSatelliteLayer(newTimestamp)
  })

  // --- 监听卫星云图可见性变化 ---
  watch(() => [timelineStore.showSatelliteCloud, timelineStore.satelliteVisibility] as const, () => {
    updateSatelliteCloudVisibility()
  }, { deep: true })

  return { updateSatelliteLayer }
}
