// app/composables/useWindLayer.ts
import type { Map } from 'maplibre-gl'
import type { WindData } from '~/utils/wind-particles'
import { WindParticleLayer } from '~/utils/wind-particles'

type MapGetter = () => Map

/** 风力粒子图层（canvas 粒子动画）+ 缩放级别同步 */
export function useWindLayer(getMap: MapGetter, ctx: { serverUrl: string }) {
  const timelineStore = useTimelineStore()
  const { serverUrl } = ctx

  let windParticleLayer: WindParticleLayer | null = null
  // 生成计数器：取消陈旧的异步加载结果
  let windLayerGen = 0

  function destroyWindLayer() {
    if (windParticleLayer) {
      windParticleLayer.destroy()
      windParticleLayer = null
    }
  }

  async function updateWindLayer() {
    const gen = ++windLayerGen
    const map = getMap()

    if (!timelineStore.showWind) {
      destroyWindLayer()
      return
    }

    await timelineStore.fetchWindManifests(serverUrl)
    if (gen !== windLayerGen)
      return

    const windTs = timelineStore.selectedWindTimestamp
    if (!windTs) {
      destroyWindLayer()
      return
    }

    try {
      const url = `${serverUrl}/atmos-tiles/wind/850hPa/particle/${windTs}.json`
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

  // 同步当前缩放级别到 store（供风力图层 zoom-aware 选项使用）
  function onMapZoom() {
    const map = getMap()
    timelineStore.windCurrentZoom = Math.round(map.getZoom())
  }

  /** 在 map 加载后调用：初始化风力图层并注册缩放同步 */
  function addWind() {
    const map = getMap()
    map.on('zoomend', onMapZoom)
    onMapZoom()
    if (timelineStore.showWind)
      updateWindLayer()
  }

  watch(() => timelineStore.showWind, () => updateWindLayer())
  watch(() => timelineStore.selectedWindTimestamp, () => updateWindLayer())
  watch(() => timelineStore.windOptions, (opts) => {
    windParticleLayer?.updateOptions(opts)
  }, { deep: true })

  // 清理：销毁粒子图层 + 移除缩放监听（修复原 onUnmounted 的遗漏）
  onScopeDispose(() => {
    destroyWindLayer()
    const map = getMap()
    map.off('zoomend', onMapZoom)
  })

  return { addWind }
}
