import type maplibregl from 'maplibre-gl'

export interface WindDataHeader {
  parameterCategory: number
  parameterNumber: number
  dx: number
  dy: number
  la1: number
  la2: number
  lo1: number
  lo2: number
  nx: number
  ny: number
  refTime: string
}

export interface WindDataItem {
  header: WindDataHeader
  data: (number | null)[]
}

export type WindData = [WindDataItem, WindDataItem]

export interface ZoomParams {
  velocityScale: number
  fadeOpacity: number
  particleCount: number
}

export interface WindOptions {
  colorScale?: string[]
  colorBySpeed?: boolean
  zoomParams?: Record<number, Partial<ZoomParams>>
}

const DEFAULT_ZOOM_PARAMS: ZoomParams = {
  velocityScale: 0.001,
  fadeOpacity: 0.80,
  particleCount: 12000,
}
const MAX_AGE = 200
const LINE_WIDTH = 2

const DEFAULT_COLORS = [
  '#043b6e',
  '#0096c7',
  '#48cae4',
  '#90e0ef',
  '#caffbf',
  '#fdffb6',
  '#ffd166',
  '#f4845f',
  '#d62828',
  '#9d0208',
]

export class WindParticleLayer {
  private map: maplibregl.Map
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private animId: number | null = null

  private nx = 0
  private ny = 0
  private lo1 = 0
  private la1 = 0
  private dx = 0
  private dy = 0
  private uGrid = new Float32Array(0)
  private vGrid = new Float32Array(0)

  private px: Float32Array
  private py: Float32Array
  private pAge: Int32Array
  private count: number

  private velocityScale = DEFAULT_ZOOM_PARAMS.velocityScale
  private maxAge = MAX_AGE
  private lineWidth = LINE_WIDTH
  private fadeOpacity = DEFAULT_ZOOM_PARAMS.fadeOpacity
  private colorScale: string[]
  private colorBySpeed: boolean
  private zoomOverrides: Record<number, Partial<ZoomParams>>
  private _visible = true
  private _moving = false

  constructor(map: maplibregl.Map, data: WindData, opts: WindOptions = {}) {
    this.map = map
    this.count = DEFAULT_ZOOM_PARAMS.particleCount
    this.colorScale = opts.colorScale ?? DEFAULT_COLORS
    this.colorBySpeed = opts.colorBySpeed ?? false
    this.zoomOverrides = opts.zoomParams ?? {}

    this.px = new Float32Array(this.count)
    this.py = new Float32Array(this.count)
    this.pAge = new Int32Array(this.count)

    this.setData(data)

    this.canvas = document.createElement('canvas')
    this.canvas.className = 'wind-particles-canvas'
    this.canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2'
    this.map.getCanvasContainer().appendChild(this.canvas)

    this.ctx = this.canvas.getContext('2d')!
    this.resize()
    this.updateZoomParams()
    this.start()

    this.map.on('resize', this.resize)
    this.map.on('movestart', this.onMoveStart)
    this.map.on('moveend', this.onMoveEnd)
    this.map.on('zoomend', this.onZoomEnd)
  }

  private resize = () => {
    const dpr = devicePixelRatio || 1
    const rect = this.map.getContainer().getBoundingClientRect()
    this.canvas.width = rect.width * dpr
    this.canvas.height = rect.height * dpr
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  private getVisibleGridBounds() {
    const bounds = this.map.getBounds()
    const sw = bounds.getSouthWest()
    const ne = bounds.getNorthEast()
    const gridSpanX = (this.nx - 1) * this.dx
    const gridSpanY = (this.ny - 1) * this.dy
    return {
      gxMin: Math.max(0, (sw.lng - this.lo1) / gridSpanX),
      gxMax: Math.min(1, (ne.lng - this.lo1) / gridSpanX),
      gyMin: Math.max(0, (this.la1 - ne.lat) / gridSpanY),
      gyMax: Math.min(1, (this.la1 - sw.lat) / gridSpanY),
    }
  }

  private resetParticles() {
    const { gxMin, gxMax, gyMin, gyMax } = this.getVisibleGridBounds()
    for (let i = 0; i < this.count; i++) {
      this.px[i] = gxMin + Math.random() * (gxMax - gxMin)
      this.py[i] = gyMin + Math.random() * (gyMax - gyMin)
      this.pAge[i] = Math.floor(Math.random() * this.maxAge)
    }
  }

  setData(data: WindData) {
    const [uItem, vItem] = data
    const h = uItem.header
    this.nx = h.nx
    this.ny = h.ny
    this.lo1 = h.lo1
    this.la1 = h.la1
    this.dx = h.dx
    this.dy = h.dy

    const len = h.nx * h.ny
    this.uGrid = new Float32Array(len)
    this.vGrid = new Float32Array(len)
    for (let i = 0; i < len; i++) {
      this.uGrid[i] = uItem.data[i] ?? 0
      this.vGrid[i] = vItem.data[i] ?? 0
    }
    this.resetParticles()
  }

  private interpolate(gx: number, gy: number): [number, number] {
    const ix = gx * (this.nx - 1)
    const iy = gy * (this.ny - 1)
    const i0 = Math.floor(ix)
    const j0 = Math.floor(iy)
    const i1 = Math.min(i0 + 1, this.nx - 1)
    const j1 = Math.min(j0 + 1, this.ny - 1)
    const fx = ix - i0
    const fy = iy - j0

    const a = j0 * this.nx
    const b = j1 * this.nx
    const u = (1 - fx) * (1 - fy) * (this.uGrid[a + i0] ?? 0) + fx * (1 - fy) * (this.uGrid[a + i1] ?? 0)
      + (1 - fx) * fy * (this.uGrid[b + i0] ?? 0) + fx * fy * (this.uGrid[b + i1] ?? 0)
    const v = (1 - fx) * (1 - fy) * (this.vGrid[a + i0] ?? 0) + fx * (1 - fy) * (this.vGrid[a + i1] ?? 0)
      + (1 - fx) * fy * (this.vGrid[b + i0] ?? 0) + fx * fy * (this.vGrid[b + i1] ?? 0)
    return [u, v]
  }

  private toPixel(gx: number, gy: number): [number, number] {
    const lng = this.lo1 + gx * (this.nx - 1) * this.dx
    const lat = this.la1 - gy * (this.ny - 1) * this.dy
    const p = this.map.project([lng, lat])
    return [p.x, p.y]
  }

  private colorForSpeed(speed: number): string {
    const t = Math.min(speed / 25, 1)
    const idx = Math.min(Math.floor(t * (this.colorScale.length - 1)), this.colorScale.length - 2)
    return this.colorScale[idx] ?? this.colorScale[0]!
  }

  private onMoveStart = () => {
    this._moving = true
    const rect = this.map.getContainer().getBoundingClientRect()
    this.ctx.clearRect(0, 0, rect.width, rect.height)
  }

  private onMoveEnd = () => {
    this._moving = false
    this.resetParticles()
    const rect = this.map.getContainer().getBoundingClientRect()
    this.ctx.clearRect(0, 0, rect.width, rect.height)
  }

  private onZoomEnd = () => {
    this.updateZoomParams()
    const rect = this.map.getContainer().getBoundingClientRect()
    this.ctx.clearRect(0, 0, rect.width, rect.height)
  }

  private updateZoomParams() {
    const z = Math.round(this.map.getZoom())
    const ovr = this.zoomOverrides[z]

    this.velocityScale = ovr?.velocityScale ?? DEFAULT_ZOOM_PARAMS.velocityScale
    this.fadeOpacity = ovr?.fadeOpacity ?? DEFAULT_ZOOM_PARAMS.fadeOpacity

    const newCount = ovr?.particleCount ?? DEFAULT_ZOOM_PARAMS.particleCount
    if (newCount !== this.count) {
      this.count = newCount
      this.px = new Float32Array(this.count)
      this.py = new Float32Array(this.count)
      this.pAge = new Int32Array(this.count)
      this.resetParticles()
    }
  }

  private frame = () => {
    if (!this._visible || this._moving) {
      this.animId = requestAnimationFrame(this.frame)
      return
    }

    const rect = this.map.getContainer().getBoundingClientRect()
    const w = rect.width
    const h = rect.height

    this.ctx.globalCompositeOperation = 'destination-in'
    this.ctx.fillStyle = `rgba(0,0,0,${this.fadeOpacity})`
    this.ctx.fillRect(0, 0, w, h)
    this.ctx.globalCompositeOperation = 'source-over'

    const vScale = this.velocityScale
    const gridSpanX = (this.nx - 1) * this.dx
    const gridSpanY = (this.ny - 1) * this.dy
    const { gxMin, gxMax, gyMin, gyMax } = this.getVisibleGridBounds()

    this.ctx.lineWidth = this.lineWidth

    if (!this.colorBySpeed) {
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
    }

    for (let i = 0; i < this.count; i++) {
      const gx = this.px[i]!
      const gy = this.py[i]!

      const [px0, py0] = this.toPixel(gx, gy)
      const [u, v] = this.interpolate(gx, gy)

      const ngx = gx + (u * vScale) / gridSpanX
      const ngy = gy - (v * vScale) / gridSpanY

      this.px[i] = ngx
      this.py[i] = ngy
      this.pAge[i] = (this.pAge[i] ?? 0) + 1

      if (ngx < gxMin || ngx > gxMax || ngy < gyMin || ngy > gyMax || this.pAge[i]! > this.maxAge) {
        this.px[i] = gxMin + Math.random() * (gxMax - gxMin)
        this.py[i] = gyMin + Math.random() * (gyMax - gyMin)
        this.pAge[i] = 0
        continue
      }

      const [px1, py1] = this.toPixel(ngx, ngy)

      if (this.colorBySpeed)
        this.ctx.strokeStyle = this.colorForSpeed(Math.sqrt(u * u + v * v))
      this.ctx.beginPath()
      this.ctx.moveTo(px0, py0)
      this.ctx.lineTo(px1, py1)
      this.ctx.stroke()
    }

    this.animId = requestAnimationFrame(this.frame)
  }

  private start() {
    this.animId = requestAnimationFrame(this.frame)
  }

  setVisible(v: boolean) {
    this._visible = v
    if (!v) {
      const rect = this.map.getContainer().getBoundingClientRect()
      this.ctx.clearRect(0, 0, rect.width, rect.height)
    }
  }

  updateOptions(opts: Partial<WindOptions>) {
    if (opts.colorBySpeed !== undefined)
      this.colorBySpeed = opts.colorBySpeed
    if (opts.zoomParams !== undefined)
      this.zoomOverrides = opts.zoomParams
    this.updateZoomParams()
  }

  destroy() {
    if (this.animId !== null) {
      cancelAnimationFrame(this.animId)
      this.animId = null
    }
    this.map.off('resize', this.resize)
    this.map.off('movestart', this.onMoveStart)
    this.map.off('moveend', this.onMoveEnd)
    this.map.off('zoomend', this.onZoomEnd)
    this.canvas.remove()
  }
}
