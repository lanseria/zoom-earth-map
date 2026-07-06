import type { Map as MapInstance } from 'maplibre-gl'
import type { StormForecastBatch, StormTrackPoint } from '~/composables/timeline'
// app/composables/useStormOverlay.ts
import maplibregl from 'maplibre-gl'

type MapGetter = () => MapInstance

interface StormLinePath {
  key: string
  d: string
  stroke: string
  strokeWidth: number
  strokeOpacity: number
  dash?: string
}
interface StormCircleEl {
  key: string
  cx: number
  cy: number
  r: number
  fill: string
  fillOpacity: number
  lng: number
  lat: number
  data: Record<string, any>
  // 仅对 active marker 有效：'breath'=呼吸圆 'rotate'=SVG旋转
  activeKind?: 'breath' | 'rotate'
  svgUrl?: string
}

/** 台风图层：用 SVG overlay 渲染路径/点位，浮在风力粒子 canvas 之上 */
export function useStormOverlay(getMap: MapGetter) {
  const timelineStore = useTimelineStore()

  // --- 配色与样式 ---
  const STORM_COLOR_BY_CODE: Record<string, string> = {
    D: '#0a84ff', // 热带低压
    S: '#00f060', // 热带风暴
    1: '#ffcc00', // 强热带风暴
    SS: '#ffcc00', // Severe Tropical Storm（强热带风暴）
    2: '#ff9400', // 台风
    T: '#ff9400', // Typhoon（台风）
    3: '#ff5900', // 强台风
    ST: '#ff5900', // Very Strong Typhoon
    4: '#ff0022', // 超强台风（暴力台风）
    VT: '#ff0022', // Violent Typhoon（暴力台风）
    5: '#FF55BB', // Cat 5
    SU: '#FF55BB', // 超级台风
  }
  const STORM_COLOR_BY_SOURCE: Record<string, string> = {
    'zoom-earth': '#00b4d8',
    'google-weather-lab': '#34d399',
    'cma': '#f87171',
    'jma': '#f4845f',
    'jtwc': '#a3e635',
    'cwa': '#60a5fa',
    'hko': '#fbbf24',
    'kma': '#a78bfa',
  }
  const STORM_ACTUAL_LINE_COLOR = '#fbbf24'
  const STORM_SOURCE_FALLBACK = '#94a3b8'
  // 统一的点位半径
  const STORM_POINT_RADIUS = 5
  const STORM_FORECAST_POINT_RADIUS = 4
  const STORM_ACTIVE_MARKER_RADIUS = 8
  const STORM_ACTIVE_SVG_RADIUS = 18
  const STORM_SVG_BY_CODE: Record<string, string> = {
    2: 'T',
    T: 'T',
    3: 'ST',
    ST: 'ST',
    4: 'VT',
    VT: 'VT',
    5: 'SU',
    SU: 'SU',
  }

  // --- 数据处理 helpers ---
  function stormActiveSvg(code: string): string | null {
    return STORM_SVG_BY_CODE[code] ?? null
  }

  function stormSourceColor(source: string) {
    return STORM_COLOR_BY_SOURCE[source] ?? STORM_SOURCE_FALLBACK
  }

  function stormPointColor(code: string) {
    return STORM_COLOR_BY_CODE[code] ?? STORM_COLOR_BY_CODE.D!
  }

  // BJT = UTC+8
  function formatStormDateBjt(iso: string) {
    const d = new Date(iso)
    const bjt = new Date(d.getTime() + 8 * 3600 * 1000)
    const mm = String(bjt.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(bjt.getUTCDate()).padStart(2, '0')
    const hh = String(bjt.getUTCHours()).padStart(2, '0')
    return `${bjt.getUTCFullYear()}-${mm}-${dd} ${hh}:00`
  }

  // 每个 source 只保留最新的一批预测
  function pickLatestForecastBatches(forecasts: StormForecastBatch[]): StormForecastBatch[] {
    const bySource = new Map<string, StormForecastBatch>()
    for (const b of forecasts) {
      const cur = bySource.get(b.source)
      if (!cur || new Date(b.issued_at) > new Date(cur.issued_at))
        bySource.set(b.source, b)
    }
    return [...bySource.values()]
  }

  function sortPointsByDate(points: StormTrackPoint[]): StormTrackPoint[] {
    return [...points].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  }

  // --- 运行时状态 ---
  let stormPopup: maplibregl.Popup | null = null
  // 触发 SVG overlay 重算的 tick（map 移动/缩放时累加）
  const stormOverlayTick = ref(0)
  // SVG 尺寸（跟随地图容器）
  const overlaySize = reactive({ width: 0, height: 0 })

  // 节流：用 RAF 把多次 move/zoom 合并到下一帧
  let stormRafId: number | null = null
  function scheduleStormOverlayUpdate() {
    if (stormRafId !== null)
      return
    stormRafId = requestAnimationFrame(() => {
      stormRafId = null
      stormOverlayTick.value++
    })
  }

  function updateOverlaySize() {
    const map = getMap()
    const rect = map.getContainer().getBoundingClientRect()
    overlaySize.width = rect.width
    overlaySize.height = rect.height
  }

  // 把地理坐标串转为 SVG path d 字符串
  function coordsToPath(coords: [number, number][]): string {
    const map = getMap()
    if (coords.length === 0)
      return ''
    let d = ''
    for (let i = 0; i < coords.length; i++) {
      const p = map.project(coords[i]!)
      d += `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)} `
    }
    return d.trim()
  }

  const stormOverlayVisible = computed(() => timelineStore.showTyphoon)

  // 一次性算出所有 SVG 元素，避免 template 里多次调用 map.project
  const stormOverlay = computed(() => {
    const map = getMap()
    // 显式依赖 tick，让 move/zoom 触发重算
    void stormOverlayTick.value

    const empty = {
      actualLines: [] as StormLinePath[],
      forecastLines: [] as StormLinePath[],
      actualPoints: [] as StormCircleEl[],
      forecastPoints: [] as StormCircleEl[],
      activeMarkers: [] as StormCircleEl[],
    }
    if (!timelineStore.showTyphoon)
      return empty

    const visibleStorms = timelineStore.activeStorms
      .filter(s => s.kind === 'storm'
        && (timelineStore.stormVisibility[s.id] ?? true)
        && timelineStore.stormTracks[s.id])

    for (const storm of visibleStorms) {
      const track = timelineStore.stormTracks[storm.id]!
      const name = track.info.name
      const history = sortPointsByDate(track.track_history)

      // 实况线
      if (history.length >= 2) {
        empty.actualLines.push({
          key: `${storm.id}-actual-line`,
          d: coordsToPath(history.map(p => [p.lng, p.lat])),
          stroke: STORM_ACTUAL_LINE_COLOR,
          strokeWidth: 3,
          strokeOpacity: 0.9,
        })
      }

      // 实况点
      history.forEach((p, idx) => {
        const screen = map.project([p.lng, p.lat])
        empty.actualPoints.push({
          key: `${storm.id}-actual-${idx}-${p.date}`,
          cx: screen.x,
          cy: screen.y,
          r: STORM_POINT_RADIUS,
          fill: stormPointColor(p.code),
          fillOpacity: 1,
          lng: p.lng,
          lat: p.lat,
          data: {
            name,
            date: p.date,
            wind: p.wind,
            pressure: p.pressure,
            code: p.code,
            description: p.description,
            source: p.source ?? 'zoom-earth',
          },
        })
      })

      // 最新实况点 → active marker
      const latest = history.at(-1)
      if (latest) {
        const screen = map.project([latest.lng, latest.lat])
        const svgName = stormActiveSvg(latest.code)
        empty.activeMarkers.push({
          key: `${storm.id}-active`,
          cx: screen.x,
          cy: screen.y,
          r: svgName ? STORM_ACTIVE_SVG_RADIUS : STORM_ACTIVE_MARKER_RADIUS,
          fill: stormPointColor(latest.code),
          fillOpacity: 1,
          lng: latest.lng,
          lat: latest.lat,
          activeKind: svgName ? 'rotate' : 'breath',
          svgUrl: svgName ? `/svg/${svgName}.svg` : undefined,
          data: {
            name,
            date: latest.date,
            wind: latest.wind,
            pressure: latest.pressure,
            code: latest.code,
            description: latest.description,
            source: latest.source ?? 'zoom-earth',
          },
        })
      }

      // 预测（按 source 取最新一批；仅渲染已开启的预测机构）
      for (const batch of pickLatestForecastBatches(track.forecasts)) {
        if (!timelineStore.stormForecastSources[batch.source])
          continue
        const sorted = sortPointsByDate(batch.points)
        if (sorted.length === 0)
          continue
        // 把当前最新实况点接到预测线开头，避免预测线和实况断开
        const lineCoords: [number, number][] = []
        if (latest)
          lineCoords.push([latest.lng, latest.lat])
        for (const p of sorted)
          lineCoords.push([p.lng, p.lat])
        if (lineCoords.length >= 2) {
          empty.forecastLines.push({
            key: `${storm.id}-forecast-line-${batch.source}`,
            d: coordsToPath(lineCoords),
            stroke: stormSourceColor(batch.source),
            strokeWidth: 2,
            strokeOpacity: 0.85,
            dash: '6,6',
          })
        }
        sorted.forEach((p, idx) => {
          const screen = map.project([p.lng, p.lat])
          empty.forecastPoints.push({
            key: `${storm.id}-forecast-${batch.source}-${idx}-${p.date}`,
            cx: screen.x,
            cy: screen.y,
            r: STORM_FORECAST_POINT_RADIUS,
            fill: stormPointColor(p.code),
            fillOpacity: 0.95,
            lng: p.lng,
            lat: p.lat,
            data: {
              name,
              date: p.date,
              wind: p.wind,
              pressure: p.pressure,
              code: p.code,
              description: p.description,
              source: batch.source,
              issued_at: batch.issued_at,
            },
          })
        })
      }
    }

    return empty
  })

  function stormPointPopupHtml(props: any): string {
    const windMs = (props.wind * 1.852).toFixed(1)
    const sourceLabel = props.source ?? 'unknown'
    const issued = props.issued_at
      ? `<div style="color:#9ca3af">发布: ${formatStormDateBjt(props.issued_at)} (${props.source})</div>`
      : `<div style="color:#9ca3af">来源: ${sourceLabel}</div>`
    return `
    <div style="font-family: 'DM Sans', sans-serif; min-width: 180px; padding: 4px 2px;">
      <div style="font-size: 14px; font-weight: 600; color: #fff; margin-bottom: 4px;">${props.name}</div>
      <div style="font-size: 12px; color: #d1d5db; line-height: 1.6;">
        <div>时刻: ${formatStormDateBjt(props.date)} BJT</div>
        <div>位置: ${Number(props.lng ?? 0).toFixed(1)}°E, ${Number(props.lat ?? 0).toFixed(1)}°N</div>
        <div>风速: ${props.wind} kt (${windMs} m/s)</div>
        <div>气压: ${props.pressure} hPa</div>
        <div>等级: ${props.code} - ${props.description}</div>
        ${issued}
      </div>
    </div>
  `
  }

  function onStormHover(isHover: boolean) {
    const map = getMap()
    map.getCanvas().style.cursor = isHover ? 'pointer' : ''
  }

  function onStormClick(el: StormCircleEl, e: MouseEvent) {
    const map = getMap()
    e.stopPropagation()
    const props = { ...el.data, lng: el.lng, lat: el.lat }
    if (stormPopup)
      stormPopup.remove()
    stormPopup = new maplibregl.Popup({ closeButton: true, maxWidth: '260px', className: 'storm-popup' })
      .setLngLat([el.lng, el.lat])
      .setHTML(stormPointPopupHtml(props))
      .addTo(map)
  }

  // 数据变化时重算 overlay（tick 已经在 move/zoom 时累加，这里只监听数据本身的变更）
  watch(() => timelineStore.showTyphoon, () => scheduleStormOverlayUpdate())
  watch(() => timelineStore.stormTracksFetchedAt, () => scheduleStormOverlayUpdate())
  watch(() => timelineStore.stormTracks, () => scheduleStormOverlayUpdate(), { deep: true })
  watch(() => timelineStore.stormVisibility, () => scheduleStormOverlayUpdate(), { deep: true })
  watch(() => timelineStore.stormForecastSources, () => scheduleStormOverlayUpdate(), { deep: true })

  /** 在 map 加载后调用：初始化 overlay 尺寸 + 注册 move/zoom/resize 监听 */
  function addStorm() {
    const map = getMap()
    // 台风 SVG overlay：地图移动/缩放时重新计算屏幕坐标
    map.on('move', scheduleStormOverlayUpdate)
    map.on('zoom', scheduleStormOverlayUpdate)
    map.on('resize', updateOverlaySize)
    // 初始化 SVG overlay 尺寸
    updateOverlaySize()
    // 首次自动拉取已关注列表，等数据回来后 SVG overlay 会响应式更新
    if (timelineStore.showTyphoon) {
      scheduleStormOverlayUpdate()
      if (timelineStore.activeStorms.length === 0)
        timelineStore.fetchActiveStorms().finally(() => scheduleStormOverlayUpdate())
    }
  }

  // 清理：移除 popup + RAF + map 事件（原 onUnmounted 的清理移入）
  onScopeDispose(() => {
    if (stormPopup) {
      stormPopup.remove()
      stormPopup = null
    }
    if (stormRafId !== null) {
      cancelAnimationFrame(stormRafId)
      stormRafId = null
    }
    const map = getMap()
    map.off('move', scheduleStormOverlayUpdate)
    map.off('zoom', scheduleStormOverlayUpdate)
    map.off('resize', updateOverlaySize)
  })

  return {
    addStorm,
    scheduleStormOverlayUpdate,
    stormOverlayVisible,
    stormOverlay,
    overlaySize,
    onStormHover,
    onStormClick,
    updateOverlaySize,
  }
}
