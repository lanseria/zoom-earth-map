import type { Map } from 'maplibre-gl'
// app/composables/useChromaticSky.ts
import maplibregl from 'maplibre-gl'
import { createApp } from 'vue'
import GlowIndexPopup from '~/components/GlowIndexPopup.vue'

type MapGetter = () => Map

/** 火烧云（chroma-sky）raster 图层 + 点击查询 glow-index 弹窗 */
export function useChromaticSky(getMap: MapGetter, ctx: { serverUrl: string, glowIndexApiUrl: string }) {
  const timelineStore = useTimelineStore()
  const { serverUrl, glowIndexApiUrl } = ctx

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
    const map = getMap()
    const sel = timelineStore.chromaticSkySelection
    if (!sel)
      return

    const [year, month, day] = [sel.date.slice(0, 4), sel.date.slice(4, 6), sel.date.slice(6, 8)]
    const dateStr = `${year}-${month}-${day}`
    // 未配置 glow-index 服务地址时跳过查询
    if (!glowIndexApiUrl)
      return
    const apiUrl = `${glowIndexApiUrl}?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}&event=${sel.event}&date=${dateStr}`

    // 加载中 popup
    closeGlowIndexPopup()
    glowIndexPopup = new maplibregl.Popup({ closeButton: true, maxWidth: '280px', className: 'glow-index-popup' })
      .setLngLat([lng, lat])
      .setDOMContent(mountPopupComponent({ data: null, error: null }))
      .addTo(map)

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

  // 全局点击查询：点到非城市区域时触发火烧云 glow-index 查询
  const onMapClick = (e: any) => {
    const map = getMap()
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
  }

  function updateChromaticSkyLayer() {
    const map = getMap()
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
    const tileUrl = `${serverUrl}/chroma-sky-tiles/{z}/{x}/{y}/${sel.date}-${sel.event}.png`

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

  /** 在 map 加载后调用：注册点击查询 + 首次渲染图层 */
  function addChromaticSky() {
    const map = getMap()
    map.on('click', onMapClick)
    updateChromaticSkyLayer()
  }

  watch(() => [timelineStore.chromaticSkySelection, timelineStore.showChromaticSky] as const, () => {
    updateChromaticSkyLayer()
  }, { deep: true })

  // 清理：关闭 popup + 移除点击监听（修复原 onUnmounted 的遗漏）
  onScopeDispose(() => {
    closeGlowIndexPopup()
    const map = getMap()
    map.off('click', onMapClick)
  })

  return { addChromaticSky }
}
