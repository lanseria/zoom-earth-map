// app/composables/useBaseMap.ts
import type { Map } from 'maplibre-gl'
import type { BaseMapType } from '~/constants/map'

type MapGetter = () => Map

/** 底图（天地图矢量/影像/地形/深色）可见性切换 */
export function useBaseMap(getMap: MapGetter) {
  const timelineStore = useTimelineStore()

  function applyBaseMap(baseMapType: BaseMapType) {
    const map = getMap()
    if (!map.isStyleLoaded())
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

  // 监听 activeBaseMap 的变化
  watch(() => timelineStore.activeBaseMap, (newBaseMap) => {
    applyBaseMap(newBaseMap)
  })

  return { applyBaseMap }
}
