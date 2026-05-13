// app/constants/map.ts

import type { StyleSpecification } from 'maplibre-gl'

const apiKey = 'COzW8kKwrFCzdf13x98K'
// --- 常量定义 ---
const TDT_KEY = '8c1768e11fec4006319e69e4a2a58793' // 你的天地图 Key

const BASE_MAP_TYPES = {
  VEC: 'vec', // 矢量
  IMG: 'img', // 影像
  TER: 'ter', // 地形
  DARK: 'dark', // 增加一个代表原始深色背景的选项
} as const

export type BaseMapType = typeof BASE_MAP_TYPES[keyof typeof BASE_MAP_TYPES]

// 卫星配置：按经度非重叠划分，覆盖全球
// goes-west (-180~-112.5) 与 goes-east (-135~0) 重叠 → -135 归 goes-east
// mtg-zero (-45~45) 与 msg-iodc (22.5~90) 重叠 → 22.5 归 msg-iodc
// msg-iodc (22.5~90) 与 himawari (67.5~180) 重叠 → 67.5 归 himawari
export const SATELLITES = [
  { id: 'goes-west', name: 'GOES-West', bounds: [-180, -60, -135, 60] as [number, number, number, number] },
  { id: 'goes-east', name: 'GOES-East', bounds: [-135, -60, -22.5, 60] as [number, number, number, number] },
  { id: 'mtg-zero', name: 'MTG', bounds: [-22.5, -60, 45, 60] as [number, number, number, number] },
  { id: 'msg-iodc', name: 'MSG-IODC', bounds: [45, -60, 90, 60] as [number, number, number, number] },
  { id: 'himawari', name: 'Himawari', bounds: [90, -60, 180, 60] as [number, number, number, number] },
]

export const MAP_STYLE_OPTIONS: { name: string, id: BaseMapType }[] = [
  { name: '天地图矢量', id: BASE_MAP_TYPES.VEC },
  { name: '天地图影像', id: BASE_MAP_TYPES.IMG },
  { name: '天地图地形', id: BASE_MAP_TYPES.TER },
  { name: '深色', id: BASE_MAP_TYPES.DARK }, // UI 选项
]

// 统一的样式定义，包含所有图层源
export const unifiedStyle: StyleSpecification = {
  version: 8,
  sprite: `https://api.maptiler.com/maps/streets-v2/sprite?key=${apiKey}`,
  glyphs: `https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=${apiKey}`,
  sources: {
    'tdt-vec': { type: 'raster', tiles: [`https://t0.tianditu.gov.cn/vec_w/wmts?tk=${TDT_KEY}&SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`], tileSize: 256 },
    'tdt-cva': { type: 'raster', tiles: [`https://t0.tianditu.gov.cn/cva_w/wmts?tk=${TDT_KEY}&SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cva&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`], tileSize: 256 },
    'tdt-img': { type: 'raster', tiles: [`https://t0.tianditu.gov.cn/img_w/wmts?tk=${TDT_KEY}&SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`], tileSize: 256 },
    'tdt-cia': { type: 'raster', tiles: [`https://t0.tianditu.gov.cn/cia_w/wmts?tk=${TDT_KEY}&SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cia&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`], tileSize: 256 },
    'tdt-ter': { type: 'raster', tiles: [`https://t0.tianditu.gov.cn/ter_w/wmts?tk=${TDT_KEY}&SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ter&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`], tileSize: 256 },
    'tdt-cta': { type: 'raster', tiles: [`https://t0.tianditu.gov.cn/cta_w/wmts?tk=${TDT_KEY}&SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cta&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`], tileSize: 256 },
  },
  layers: [
    // --- 底图层 ---
    { id: 'background', type: 'background', paint: { 'background-color': '#333333' } }, // 保留一个背景色作为备用
    { id: 'tdt-vec-layer', type: 'raster', source: 'tdt-vec', layout: { visibility: 'none' } },
    { id: 'tdt-img-layer', type: 'raster', source: 'tdt-img', layout: { visibility: 'none' } },
    { id: 'tdt-ter-layer', type: 'raster', source: 'tdt-ter', layout: { visibility: 'none' } },
    // --- 注记层 (放在底图之上) ---
    { id: 'tdt-cva-layer', type: 'raster', source: 'tdt-cva', layout: { visibility: 'none' } }, // 矢量注记
    { id: 'tdt-cia-layer', type: 'raster', source: 'tdt-cia', layout: { visibility: 'none' } }, // 影像注记
    { id: 'tdt-cta-layer', type: 'raster', source: 'tdt-cta', layout: { visibility: 'none' } }, // 地形注记
  ],
}
