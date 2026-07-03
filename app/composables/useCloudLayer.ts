// app/composables/useCloudLayer.ts
import type { Map } from 'maplibre-gl'

type MapGetter = () => Map

/** 云量 / 能见度 raster 瓦片图层 */
export function useCloudLayer(getMap: MapGetter, ctx: { serverUrl: string }) {
  const timelineStore = useTimelineStore()
  const { serverUrl } = ctx

  const CLOUD_SOURCE_ID = 'cloud-source'
  const CLOUD_LAYER_ID = 'cloud-layer'

  function updateCloudLayer() {
    const map = getMap()
    if (!map.isStyleLoaded()) {
      map.once('idle', updateCloudLayer)
      return
    }

    if (map.getLayer(CLOUD_LAYER_ID))
      map.removeLayer(CLOUD_LAYER_ID)
    if (map.getSource(CLOUD_SOURCE_ID))
      map.removeSource(CLOUD_SOURCE_ID)

    if (!timelineStore.showCloud)
      return

    const ts = timelineStore.selectedCloudTimestamp
    if (!ts)
      return

    const type = timelineStore.cloudType
    const variable = timelineStore.cloudVariable
    const subPath = variable === 'vis' ? 'vis/surface' : `${type}/atmos`
    const url = [serverUrl, 'atmos-tiles', subPath, '{z}', '{x}', '{y}', `${ts}.png`].join('/')

    map.addSource(CLOUD_SOURCE_ID, {
      type: 'raster',
      tiles: [url],
      tileSize: 256,
      minzoom: 3,
      maxzoom: 4,
    })

    map.addLayer({
      id: CLOUD_LAYER_ID,
      type: 'raster',
      source: CLOUD_SOURCE_ID,
      paint: {
        'raster-opacity': timelineStore.cloudOpacity,
      },
    }, 'country-boundaries-outline-layer')
  }

  watch(() => timelineStore.showCloud, async () => {
    if (timelineStore.showCloud)
      await timelineStore.fetchCloudManifests(serverUrl)
    updateCloudLayer()
  })
  watch(() => timelineStore.selectedCloudTimestamp, () => updateCloudLayer())
  watch(() => timelineStore.cloudType, async () => {
    timelineStore.resetCloudManifests()
    if (timelineStore.showCloud)
      await timelineStore.fetchCloudManifests(serverUrl)
    updateCloudLayer()
  })
  watch(() => timelineStore.cloudVariable, async () => {
    timelineStore.resetCloudManifests()
    if (timelineStore.showCloud)
      await timelineStore.fetchCloudManifests(serverUrl)
    updateCloudLayer()
  })
  watch(() => timelineStore.cloudOpacity, (v) => {
    const map = getMap()
    if (map.getLayer(CLOUD_LAYER_ID))
      map.setPaintProperty(CLOUD_LAYER_ID, 'raster-opacity', v)
  })

  // 组件卸载时清理本图层注册的 source / layer
  onScopeDispose(() => {
    const map = getMap()
    for (const id of [CLOUD_LAYER_ID, CLOUD_SOURCE_ID]) {
      if (map.getLayer(id))
        map.removeLayer(id)
      if (map.getSource(id))
        map.removeSource(id)
    }
  })

  return { addCloud: updateCloudLayer }
}
