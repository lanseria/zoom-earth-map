// app/composables/useTempLayer.ts
import type { Map } from 'maplibre-gl'

type MapGetter = () => Map

/** 温度/湿度 raster 瓦片图层 */
export function useTempLayer(getMap: MapGetter, ctx: { serverUrl: string }) {
  const timelineStore = useTimelineStore()
  const { serverUrl } = ctx

  const TEMP_SOURCE_ID = 'temp-source'
  const TEMP_LAYER_ID = 'temp-layer'

  function updateTempLayer() {
    const map = getMap()
    if (!map.isStyleLoaded()) {
      map.once('idle', updateTempLayer)
      return
    }

    // 清除旧图层
    if (map.getLayer(TEMP_LAYER_ID))
      map.removeLayer(TEMP_LAYER_ID)
    if (map.getSource(TEMP_SOURCE_ID))
      map.removeSource(TEMP_SOURCE_ID)

    if (!timelineStore.showTemp)
      return

    const ts = timelineStore.selectedTempTimestamp
    if (!ts)
      return

    const level = '850hPa'
    const variable = timelineStore.tempVariable
    const url = [serverUrl, 'atmos-tiles', variable, level, '{z}', '{x}', '{y}', `${ts}.png`].join('/')

    map.addSource(TEMP_SOURCE_ID, {
      type: 'raster',
      tiles: [url],
      tileSize: 256,
      minzoom: 3,
      maxzoom: 4,
    })

    map.addLayer({
      id: TEMP_LAYER_ID,
      type: 'raster',
      source: TEMP_SOURCE_ID,
      paint: {
        'raster-opacity': timelineStore.tempOpacity,
      },
    }, 'country-boundaries-outline-layer')
  }

  watch(() => timelineStore.showTemp, async () => {
    if (timelineStore.showTemp)
      await timelineStore.fetchTempManifests(serverUrl)
    updateTempLayer()
  })
  watch(() => timelineStore.selectedTempTimestamp, () => updateTempLayer())
  watch(() => timelineStore.tempVariable, async () => {
    timelineStore.resetTempManifests()
    if (timelineStore.showTemp)
      await timelineStore.fetchTempManifests(serverUrl)
    updateTempLayer()
  })
  watch(() => timelineStore.tempOpacity, (v) => {
    const map = getMap()
    if (map.getLayer(TEMP_LAYER_ID))
      map.setPaintProperty(TEMP_LAYER_ID, 'raster-opacity', v)
  })

  // 组件卸载时清理本图层注册的 source / layer
  onScopeDispose(() => {
    const map = getMap()
    for (const id of [TEMP_LAYER_ID, TEMP_SOURCE_ID]) {
      if (map.getLayer(id))
        map.removeLayer(id)
      if (map.getSource(id))
        map.removeSource(id)
    }
  })

  return { addTemp: updateTempLayer }
}
