// app/composables/useMapProjection.ts
import type { Map } from 'maplibre-gl'

type MapGetter = () => Map

/** 地图投影（mercator / globe）切换 */
export function useMapProjection(getMap: MapGetter) {
  const timelineStore = useTimelineStore()

  /** 在 map 加载后调用，恢复存储的投影设置 */
  function applyProjection() {
    const map = getMap()
    if (timelineStore.mapProjection === 'globe')
      map.setProjection({ type: 'globe' })
  }

  watch(() => timelineStore.mapProjection, (newProjection) => {
    getMap().setProjection({ type: newProjection })
  })

  return { applyProjection }
}
