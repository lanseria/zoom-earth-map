// app/utils/cloudHeight.ts
// 利用卫星云图阴影反演云顶高度（含卫星视差修正），仅支持 Himawari-8 静止卫星。
//
// 原理：
//  1) 在云图上点选云顶视位置 A 与云影实地位置 B，量取两者水平位移 ΔL；
//  2) ΔL 由两个矢量分量合成：太阳投影分量 H·tan(α)（沿背日方向，α 为太阳天顶角，
//     等价于经典的 H·cot(高度角) 阴影长度公式）与卫星视差分量 H·tan(β)（沿背星方向）；
//  3) 平面矢量合成公式（消除视差）：
//       H = ΔL / sqrt(tan²β + tan²α − 2·tanβ·tanα·cos(φ_sat − φ_sun))
//     其中 α/β 为点 B 处的太阳/卫星天顶角，φ_sat、φ_sun 为方位角（正北起顺时针）。
//     注 1：太阳投影分量为 H·tan(α)（= H·cot(太阳高度角)，即经典阴影长度公式），
//          与卫星视差分量 H·tan(β) 对称；若把 α 理解为太阳高度角，该项即写作 cot(α)。
//     注 2：若把方位差理解为「背星方向与向阳方向」的夹角，根号内为「+」号，两种写法等价。
//     本实现按天顶角 + 方位角之差直接推导，已通过三维光线追踪正问题数值验证。
//  4) 当 β > 50° 或平面解 H > 10 km 时，平面近似误差显著（地球曲率不可忽略），
//     切换为迭代光线追踪精确解（收敛阈值 1 m）。
// 质量控制：
//  - 仅接受 Himawari-8 覆盖区（90°E~180°，60°S~60°N）内的选点；
//  - 太阳天顶角 α ≤ 30° 时阴影过短，给出警告（建议选用早晚时刻图像）；
//  - ΔL 小于影像有效分辨率 2 倍时放弃计算（信号太弱）。

export interface LatLng {
  lat: number
  lng: number
}

type Vec3 = [number, number, number]

/** Himawari-8 星历常量（静止轨道） */
export const HIMAWARI8 = {
  /** 星下点经度（东经） */
  subLonDeg: 140.7,
  /** 卫星地心距：WGS84 赤道半径 + 标称静止轨道高度 35786 km */
  geoRadiusM: 6378137 + 35786000,
  /** 可见光彩色合成影像的保守地面分辨率（米） */
  sensorResolutionM: 1000,
  /** 有效覆盖范围 [west, south, east, north] */
  bounds: [90, -60, 180, 60] as [number, number, number, number],
}

// --- 基础数学 ---
const D2R = Math.PI / 180
const R2D = 180 / Math.PI
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const mod360 = (deg: number): number => ((deg % 360) + 360) % 360
function normalizeDeg(deg: number): number {
  const m = mod360(deg)
  return m > 180 ? m - 360 : m
}

const vAdd = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const vSub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const vScale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
const vDot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const vLen = (a: Vec3): number => Math.sqrt(vDot(a, a))
const vNorm = (a: Vec3): Vec3 => vScale(a, 1 / vLen(a))

// --- WGS84 坐标转换 ---
const WGS84_A = 6378137
const WGS84_F = 1 / 298.257223563
const WGS84_E2 = WGS84_F * (2 - WGS84_F)

/** 大地坐标（度，海拔米）→ 地心地固直角坐标 ECEF（米） */
export function geodeticToEcef(latDeg: number, lonDeg: number, hM = 0): Vec3 {
  const lat = latDeg * D2R
  const lon = lonDeg * D2R
  const sinLat = Math.sin(lat)
  const cosLat = Math.cos(lat)
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat)
  return [
    (n + hM) * cosLat * Math.cos(lon),
    (n + hM) * cosLat * Math.sin(lon),
    (n * (1 - WGS84_E2) + hM) * sinLat,
  ]
}

/** ECEF（米）→ 大地坐标（度，海拔米），迭代法（中低纬度亚毫米级收敛） */
export function ecefToGeodetic(p: Vec3): { latDeg: number, lonDeg: number, hM: number } {
  const [x, y, z] = p
  const lon = Math.atan2(y, x)
  const r = Math.hypot(x, y)
  let lat = Math.atan2(z, r * (1 - WGS84_E2))
  let sinLat = Math.sin(lat)
  let n = WGS84_A
  for (let i = 0; i < 8; i++) {
    n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat)
    lat = Math.atan2(z + n * WGS84_E2 * sinLat, r)
    sinLat = Math.sin(lat)
  }
  const hM = r / Math.cos(lat) - n
  return { latDeg: lat * R2D, lonDeg: lon * R2D, hM }
}

/** 点 P 处的 ENU（东北天）单位基向量（ECEF 表示） */
export function localEnuAxes(latDeg: number, lonDeg: number): { e: Vec3, n: Vec3, u: Vec3 } {
  const lat = latDeg * D2R
  const lon = lonDeg * D2R
  const sinLat = Math.sin(lat)
  const cosLat = Math.cos(lat)
  const sinLon = Math.sin(lon)
  const cosLon = Math.cos(lon)
  return {
    e: [-sinLon, cosLon, 0],
    n: [-sinLat * cosLon, -sinLat * sinLon, cosLat],
    u: [cosLat * cosLon, cosLat * sinLon, sinLat],
  }
}

// --- 太阳照明几何（NOAA Solar Position 算法，误差 < 0.01°）---
export interface SolarPosition {
  /** 太阳天顶角 α（度） */
  zenithDeg: number
  /** 太阳方位角（度，正北起顺时针） */
  azimuthDeg: number
}

export function solarPosition(date: Date, latDeg: number, lonDeg: number): SolarPosition {
  const jd = date.getTime() / 86400000 + 2440587.5
  const t = (jd - 2451545) / 36525

  const l0 = mod360(280.46646 + t * (36000.76983 + t * 0.0003032))
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t)
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
  const mRad = m * D2R
  const c = Math.sin(mRad) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * mRad) * (0.019993 - 0.000101 * t)
    + Math.sin(3 * mRad) * 0.000289
  const trueLong = l0 + c
  const omega = 125.04 - 1934.136 * t
  const lambda = (trueLong - 0.00569 - 0.00478 * Math.sin(omega * D2R)) * D2R
  const sec = 21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))
  const eps = (23 + (26 + sec / 60) / 60 + 0.00256 * Math.cos(omega * D2R)) * D2R
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda))
  const y = Math.tan(eps / 2) ** 2
  const eqTime = 4 * R2D * (
    y * Math.sin(2 * l0 * D2R)
    - 2 * e * Math.sin(mRad)
    + 4 * e * y * Math.sin(mRad) * Math.cos(2 * l0 * D2R)
    - 0.5 * y * y * Math.sin(4 * l0 * D2R)
    - 1.25 * e * e * Math.sin(2 * mRad)
  )

  const minutesUtc = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60
  const trueSolarTime = minutesUtc + eqTime + 4 * lonDeg
  const ha = normalizeDeg(trueSolarTime / 4 - 180) * D2R
  const lat = latDeg * D2R

  const cosZen = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha)
  const zenithDeg = Math.acos(clamp(cosZen, -1, 1)) * R2D
  const azimuthDeg = mod360(
    Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) * R2D + 180,
  )
  return { zenithDeg, azimuthDeg }
}

/** 点 P 处指向太阳的单位向量（ECEF） */
export function sunDirectionEcef(latDeg: number, lonDeg: number, sun: SolarPosition): Vec3 {
  const { e, n, u } = localEnuAxes(latDeg, lonDeg)
  const elevR = (90 - sun.zenithDeg) * D2R
  const azR = sun.azimuthDeg * D2R
  const ce = Math.cos(elevR)
  return vNorm(vAdd(
    vAdd(vScale(e, Math.sin(azR) * ce), vScale(n, Math.cos(azR) * ce)),
    vScale(u, Math.sin(elevR)),
  ))
}

// --- 卫星观测几何 ---
export function satellitePositionEcef(): Vec3 {
  const lon = HIMAWARI8.subLonDeg * D2R
  const r = HIMAWARI8.geoRadiusM
  return [r * Math.cos(lon), r * Math.sin(lon), 0]
}

export interface SatelliteGeometry {
  /** 卫星天顶角 β（度） */
  zenithDeg: number
  /** 卫星方位角（度，正北起顺时针） */
  azimuthDeg: number
  /** 卫星到地面点的直线距离（米） */
  distanceM: number
}

/** 地面点 P 处的卫星观测几何（视线与天顶方向夹角、朝卫星的水平方位角） */
export function satelliteGeometry(latDeg: number, lonDeg: number): SatelliteGeometry {
  const p = geodeticToEcef(latDeg, lonDeg, 0)
  const { e, n, u } = localEnuAxes(latDeg, lonDeg)
  const v = vSub(satellitePositionEcef(), p)
  const distanceM = vLen(v)
  const zenithDeg = Math.acos(clamp(vDot(v, u) / distanceM, -1, 1)) * R2D
  const azimuthDeg = mod360(Math.atan2(vDot(v, e), vDot(v, n)) * R2D)
  return { zenithDeg, azimuthDeg, distanceM }
}

// --- 距离 ---
const EARTH_R_MEAN = 6371008.8

/** 球面大圆距离（米） */
export function haversineDistanceM(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * D2R
  const dLon = (b.lng - a.lng) * D2R
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_R_MEAN * Math.asin(Math.sqrt(clamp(s, 0, 1)))
}

// --- 光线追踪（高精度修正）---

/**
 * 沿射线 origin + t·dir（t>0，dir 任意）求海拔到达 targetH 的参数 t。
 * 牛顿迭代（数值导数）；要求海拔沿射线在解附近单调（观测/投影光线均满足）。
 */
export function marchRayToAltitude(origin: Vec3, dir: Vec3, targetH: number, tInit: number): number {
  const d = vNorm(dir)
  let t = Math.max(tInit, 1)
  for (let i = 0; i < 60; i++) {
    const f = ecefToGeodetic(vAdd(origin, vScale(d, t))).hM - targetH
    if (Math.abs(f) < 1e-3)
      return t
    const h = Math.max(t * 1e-5, 1)
    const df = (ecefToGeodetic(vAdd(origin, vScale(d, t + h))).hM - targetH - f) / h
    if (!Number.isFinite(df) || Math.abs(df) < 1e-9)
      break
    const next = t - f / df
    t = Number.isFinite(next) && next > 0 ? next : t / 2
  }
  return t
}

/**
 * 迭代光线追踪反演云高（β > 50° 或 H > 10 km 时启用，收敛阈值 1 m）：
 *  1) 云顶真实点 C(H)：卫星→A 视线上海拔为 H 的点；
 *  2) 自 C 沿背离太阳方向投射至地面，得预测云影 G'(H)；
 *  3) 残差 f(H) = G'(H) − B 在「背日水平方向」上的投影，f 随 H 近似线性；
 *  4) 弦截法迭代至 |f| < 1 m，收敛的 H 即精确云高。
 * 返回 null 表示未收敛（选点与几何不一致，如 A/B 点反或云高超出量程）。
 */
function rayTraceCloudHeight(
  time: Date,
  cloudTop: LatLng,
  shadow: LatLng,
  planarHeightM: number,
): number | null {
  const sun = solarPosition(time, shadow.lat, shadow.lng)
  const sunDir = sunDirectionEcef(shadow.lat, shadow.lng, sun)
  const shadowDir = vScale(sunDir, -1)
  const sat = satellitePositionEcef()
  const aEcef = geodeticToEcef(cloudTop.lat, cloudTop.lng, 0)
  const viewDir = vNorm(vSub(aEcef, sat))
  const viewLen = vLen(vSub(aEcef, sat))
  const bEcef = geodeticToEcef(shadow.lat, shadow.lng, 0)

  // 点 B 处「背离太阳」的水平单位向量（ECEF）
  const { e, n } = localEnuAxes(shadow.lat, shadow.lng)
  const antiAz = (sun.azimuthDeg + 180) * D2R
  const antiSun = vNorm(vAdd(vScale(e, Math.sin(antiAz)), vScale(n, Math.cos(antiAz))))

  const sunElevR = (90 - sun.zenithDeg) * D2R
  const tShadowScale = 1 / Math.max(Math.cos(sunElevR), 0.02)

  function predictedShadowEcef(H: number): Vec3 {
    const tC = marchRayToAltitude(sat, viewDir, H, viewLen)
    const c = vAdd(sat, vScale(viewDir, tC))
    const tG = marchRayToAltitude(c, shadowDir, 0, Math.max(H, 10) * tShadowScale)
    return vAdd(c, vScale(shadowDir, tG))
  }

  const residual = (H: number): number => vDot(vSub(predictedShadowEcef(H), bEcef), antiSun)

  // 量程 [30 m, 25 km]，要求两端残差变号（f 近似线性，必有点内根）
  const lo = 30
  const hi = 25000
  const fLo = residual(lo)
  const fHi = residual(hi)
  if (fLo * fHi > 0)
    return null

  // Illinois 弦截法（牛顿类超线性收敛 + 区间保护）
  let xl = fLo < 0 ? lo : hi
  let xr = fLo < 0 ? hi : lo
  let lastSide: number | null = null
  let x = clamp(planarHeightM, lo, hi)
  for (let i = 0; i < 80; i++) {
    const fl = residual(xl)
    const fr = residual(xr)
    x = (xl * fr - xr * fl) / (fr - fl)
    if (!Number.isFinite(x))
      return null
    const fx = residual(x)
    if (Math.abs(fx) < 1)
      return x
    const side = fx < 0 ? -1 : 1
    if (side < 0)
      xl = x
    else
      xr = x
    if (side === lastSide) {
      // 连续同侧：Illinois 修正，压缩另一端避免收敛爬行
      if (side < 0)
        xr = (xr + x) / 2
      else
        xl = (xl + x) / 2
    }
    lastSide = side
    if (Math.abs(xr - xl) < 0.5)
      return (xl + xr) / 2
  }
  return (xl + xr) / 2
}

// --- 统一入口 ---
export interface CloudHeightOptions {
  /** 影像拍摄时间（UTC） */
  time: Date
  /** 点 A：云顶在云图上的视位置 */
  cloudTop: LatLng
  /** 点 B：云影的实地位置 */
  shadow: LatLng
  /** 影像有效地面分辨率（米），识别阈值 = 2×该值；与传感器分辨率取较大者 */
  resolutionM?: number
}

export interface CloudHeightResult {
  /** 是否通过质量控制并给出结果 */
  valid: boolean
  /** 拒绝计算的原因（valid=false 时给出） */
  rejection: string | null
  /** 反演云顶高度（米） */
  heightM: number | null
  /** 主结果方法：平面矢量合成 / 光线追踪 */
  method: 'planar' | 'ray-trace' | null
  /** 平面矢量公式解（米） */
  planarHeightM: number | null
  /** 光线追踪解（米；未启用或未收敛时为 null） */
  rayTracedHeightM: number | null
  /** A、B 实测水平位移（米） */
  deltaLM: number
  /** 识别阈值 = 2×有效分辨率（米） */
  thresholdM: number
  /** 太阳天顶角 α（度，点 B 处） */
  solarZenithDeg: number
  /** 太阳方位角（度，正北起顺时针，点 B 处） */
  solarAzimuthDeg: number
  /** 卫星天顶角 β（度，点 B 处） */
  satZenithDeg: number
  /** 卫星方位角（度，正北起顺时针，点 B 处） */
  satAzimuthDeg: number
  /** 质量控制警告 */
  warnings: string[]
}

function withinHimawari(p: LatLng): boolean {
  const [w, s, east, north] = HIMAWARI8.bounds
  return p.lng >= w && p.lng <= east && p.lat >= s && p.lat <= north
}

export function computeCloudHeight(opts: CloudHeightOptions): CloudHeightResult {
  const { time, cloudTop, shadow } = opts
  const warnings: string[] = []
  const resolutionM = Math.max(HIMAWARI8.sensorResolutionM, opts.resolutionM ?? 0)
  const thresholdM = 2 * resolutionM

  const sun = solarPosition(time, shadow.lat, shadow.lng)
  const sat = satelliteGeometry(shadow.lat, shadow.lng)
  const deltaLM = haversineDistanceM(cloudTop, shadow)

  const reject = (msg: string): CloudHeightResult => ({
    valid: false,
    rejection: msg,
    heightM: null,
    method: null,
    planarHeightM: null,
    rayTracedHeightM: null,
    deltaLM,
    thresholdM,
    solarZenithDeg: sun.zenithDeg,
    solarAzimuthDeg: sun.azimuthDeg,
    satZenithDeg: sat.zenithDeg,
    satAzimuthDeg: sat.azimuthDeg,
    warnings,
  })

  // 适用范围：仅 Himawari-8 覆盖区
  if (!withinHimawari(cloudTop) || !withinHimawari(shadow)) {
    return reject('选点超出 Himawari-8 覆盖范围（90°E~180°，60°S~60°N），无法测量')
  }
  // 太阳须在地平线上（夜间无云影）
  if (sun.zenithDeg >= 90) {
    return reject('太阳位于地平线以下（当前时刻该点位无云影），无法测量')
  }
  // 识别阈值：位移量过小则放弃计算
  if (deltaLM < thresholdM) {
    return reject(`水平位移 ${(deltaLM / 1000).toFixed(2)} km 小于识别阈值 ${(thresholdM / 1000).toFixed(2)} km（影像分辨率 2 倍），信号太弱，已放弃计算`)
  }
  // 方向一致性：位移 B−A 在背日水平方向上的投影应为正（云影必然落在背日侧），
  // 否则大概率是 A（云顶）与 B（云影）点反
  {
    const { e, n } = localEnuAxes(shadow.lat, shadow.lng)
    const antiAz = (sun.azimuthDeg + 180) * D2R
    const antiSun = vAdd(vScale(e, Math.sin(antiAz)), vScale(n, Math.cos(antiAz)))
    const abEcef = vSub(
      geodeticToEcef(shadow.lat, shadow.lng, 0),
      geodeticToEcef(cloudTop.lat, cloudTop.lng, 0),
    )
    if (vDot(abEcef, antiSun) < 0)
      warnings.push('位移方向与阴影几何不一致：A（云顶）与 B（云影）可能点反，结果不可靠')
  }

  // 平面矢量合成公式：H = ΔL / |tan(β)·û背星 − tan(α)·û背日|
  const tanBeta = Math.tan(sat.zenithDeg * D2R)
  const tanAlpha = Math.tan(sun.zenithDeg * D2R)
  const dPhi = (sat.azimuthDeg - sun.azimuthDeg) * D2R
  const denomSq = tanBeta * tanBeta + tanAlpha * tanAlpha - 2 * tanBeta * tanAlpha * Math.cos(dPhi)
  if (denomSq < 1e-9) {
    return reject('卫星视差分量与太阳阴影分量近乎相互抵消（太阳与卫星方位接近重合且高度相当），无法反演')
  }
  const planarHeightM = deltaLM / Math.sqrt(denomSq)

  // β > 50°、云高 > 10 km 或低太阳（α > 80°，掠射阴影拉长）时，
  // 平面近似的地球曲率误差显著，启用迭代光线追踪精确解
  let rayTracedHeightM: number | null = null
  let method: 'planar' | 'ray-trace' = 'planar'
  if (sat.zenithDeg > 50 || planarHeightM > 10000 || sun.zenithDeg > 80) {
    rayTracedHeightM = rayTraceCloudHeight(time, cloudTop, shadow, planarHeightM)
    if (rayTracedHeightM != null) {
      method = 'ray-trace'
    }
    else {
      warnings.push('光线追踪未收敛（A/B 选点方向可能不符），结果退回平面公式，仅供参考')
    }
  }

  const heightM = method === 'ray-trace' ? rayTracedHeightM! : planarHeightM

  // 质量控制警告
  if (sun.zenithDeg <= 30) {
    warnings.push(`太阳天顶角 α=${sun.zenithDeg.toFixed(1)}° ≤ 30°，阴影过短，相对误差较大，建议选用早晚时刻图像`)
  }
  if (sun.zenithDeg > 80) {
    warnings.push(`太阳天顶角 α=${sun.zenithDeg.toFixed(1)}° 过大，云影拉长且易受地形影响，结果仅供参考`)
  }
  if (sat.zenithDeg > 60) {
    warnings.push(`卫星天顶角 β=${sat.zenithDeg.toFixed(1)}° > 60°，观测几何倾斜，建议尽量选择靠近星下点（140.7°E）的目标`)
  }
  if (heightM > 20000) {
    warnings.push(`反演高度 ${(heightM / 1000).toFixed(1)} km 明显超出对流层云常见范围，请复核 A/B 选点`)
  }

  return {
    valid: true,
    rejection: null,
    heightM,
    method,
    planarHeightM,
    rayTracedHeightM,
    deltaLM,
    thresholdM,
    solarZenithDeg: sun.zenithDeg,
    solarAzimuthDeg: sun.azimuthDeg,
    satZenithDeg: sat.zenithDeg,
    satAzimuthDeg: sat.azimuthDeg,
    warnings,
  }
}
