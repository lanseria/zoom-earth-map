// app/utils/stormImport.ts
// 第三方台风预测路径导入工具：纯函数，无副作用，便于复用与测试。

import type { StormCode, StormForecastBatch, StormTrackPoint } from '~/composables/timeline'

/**
 * 第三方导入来源的命名空间前缀。
 * 每个导入的预测批次 source 形如 `imported:FNV3`、`imported:GRPH`，
 * 模型名取自 CSV 文件名前缀，多个模型作为独立预测路径共存。
 */
export const IMPORT_SOURCE_PREFIX = 'imported:'

/** 由模型名构造导入来源标识 */
export function makeImportedSource(model: string): string {
  return `${IMPORT_SOURCE_PREFIX}${model}`
}

/** 判断某个 source 是否为第三方导入来源 */
export function isImportedSource(source: string): boolean {
  return source.startsWith(IMPORT_SOURCE_PREFIX)
}

/** 从导入来源标识中提取模型名 */
export function importedModelName(source: string): string {
  return source.slice(IMPORT_SOURCE_PREFIX.length)
}

// 导入来源配色盘（与内置实时源颜色错开）
const IMPORT_PALETTE = ['#34d399', '#f472b6', '#22d3ee', '#facc15', '#a3e635', '#fb923c', '#c084fc', '#f87171', '#60a5fa', '#fde047']

/**
 * 由模型名确定性地推导一个稳定颜色（同名模型跨会话颜色一致）。
 * 使用 cyrb53 字符串哈希，分布均匀，能尽量让不同模型落到不同颜色。
 */
export function importedSourceColor(source: string): string {
  const name = importedModelName(source)
  let h1 = 0xDEADBEEF
  let h2 = 0x41C6CE57
  for (let i = 0; i < name.length; i++) {
    const ch = name.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h2 = Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  // 最终只用 h1 的低 31 位做取模即可，足以让短模型名分布均匀
  const idx = (h1 >>> 0) % IMPORT_PALETTE.length
  return IMPORT_PALETTE[idx]!
}

/**
 * 从 CSV 文件名中提取模型名前缀。
 * 例如 `FNV3_2026_07_06T00_00_paired.csv` → `FNV3`。
 * 若无下划线则取去掉扩展名后的整个文件名。
 */
export function extractModelFromFileName(fileName: string): string {
  const stem = fileName.replace(/[\\/]/g, '/').split('/').pop()!.replace(/\.csv$/i, '')
  const idx = stem.indexOf('_')
  const model = idx === -1 ? stem : stem.slice(0, idx)
  return model.trim() || 'unknown'
}

/**
 * 根据风速（knots）推导台风强度等级 code 与中文描述。
 * 阈值参考热带气旋等级标准（节）。
 */
export function windKnotsToStormCode(wind: number): { code: StormCode, description: string } {
  if (wind < 34)
    return { code: 'D', description: '热带低压' }
  if (wind < 48)
    return { code: 'S', description: '热带风暴' }
  if (wind < 64)
    return { code: '1', description: '强热带风暴' }
  if (wind < 81)
    return { code: '2', description: '台风' }
  if (wind < 100)
    return { code: '3', description: '强台风' }
  if (wind < 137)
    return { code: '4', description: '超强台风' }
  return { code: '5', description: '超强台风' }
}

/** 把 CSV 中的 "2026-07-05 18:00:00" 或 "2026-07-06" 规范化为 UTC ISO 字符串 */
function normalizeIsoTime(raw: string): string {
  const trimmed = raw.trim().replace(' ', 'T')
  if (!trimmed)
    return ''
  // Google Weather Lab 数据为 UTC，显式补 Z 以保证跨时区解析一致
  return /z|[+-]\d{2}:?\d{2}$/i.test(trimmed) ? trimmed : `${trimmed}Z`
}

/** 安全地把单元格解析为数字，空字符串返回 null */
function toNumberOrNull(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '')
    return null
  const n = Number(trimmed)
  return Number.isNaN(n) ? null : n
}

/** 解析一行 CSV（按逗号切分；该格式不含带引号的逗号） */
function splitCsvLine(line: string): string[] {
  return line.split(',').map(c => c.trim())
}

/**
 * 解析 Google Weather Lab 的 CSV 文本为一条预测批次。
 * 仅保留控制样本（sample = -1）。
 * 模型名取自文件名前缀，作为独立来源 source，多个模型共存显示。
 * 抛出带上下文的 Error，由调用方捕获后展示给用户。
 */
export function parseGoogleWeatherLabCsv(text: string, fileName: string): StormForecastBatch {
  const model = extractModelFromFileName(fileName)
  const source = makeImportedSource(model)

  const lines = text.split(/\r?\n/)

  // 定位表头行（以 init_time 开头），跳过 # 注释
  let headerIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (line.startsWith('#') || line === '')
      continue
    if (line.startsWith('init_time')) {
      headerIdx = i
      break
    }
  }
  if (headerIdx === -1)
    throw new Error('CSV 缺少表头行（未找到 init_time 开头的行）')

  const headers = splitCsvLine(lines[headerIdx]!)
  const col = (name: string): number => headers.indexOf(name)

  const required = ['init_time', 'sample', 'valid_time', 'lat', 'lon', 'maximum_sustained_wind_speed_knots', 'minimum_sea_level_pressure_hpa']
  const missing = required.filter(c => col(c) === -1)
  if (missing.length > 0)
    throw new Error(`CSV 缺少必需列：${missing.join(', ')}`)

  const iInit = col('init_time')
  const iSample = col('sample')
  const iValid = col('valid_time')
  const iLat = col('lat')
  const iLon = col('lon')
  const iWind = col('maximum_sustained_wind_speed_knots')
  const iPressure = col('minimum_sea_level_pressure_hpa')

  const points: StormTrackPoint[] = []
  let issuedAt = ''

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (line === '' || line.startsWith('#'))
      continue

    const cells = splitCsvLine(line)
    if (cells.length < headers.length)
      continue

    const sample = toNumberOrNull(cells[iSample]!)
    // 仅保留控制样本（sample = -1）
    if (sample !== null && sample !== -1)
      continue

    const lat = toNumberOrNull(cells[iLat]!)
    const lon = toNumberOrNull(cells[iLon]!)
    const wind = toNumberOrNull(cells[iWind]!)
    const pressure = toNumberOrNull(cells[iPressure]!)
    if (lat === null || lon === null || wind === null || pressure === null)
      continue

    const validTime = cells[iValid]!.trim()
    if (!validTime)
      continue

    if (!issuedAt) {
      const initRaw = cells[iInit]!.trim()
      if (initRaw)
        issuedAt = normalizeIsoTime(initRaw)
    }

    const { code, description } = windKnotsToStormCode(wind)
    points.push({
      date: normalizeIsoTime(validTime),
      lng: lon,
      lat,
      wind,
      pressure,
      code,
      description,
      source,
    })
  }

  if (points.length === 0)
    throw new Error('CSV 中未找到有效的控制样本（sample = -1）数据行')

  return {
    source,
    issued_at: issuedAt,
    points,
  }
}

/** 导入类型清单：供面板渲染下拉选项并分发解析器，便于以后扩展更多类型 */
export interface StormImportType {
  id: string
  label: string
  accept: string
  parse: (text: string, fileName: string) => StormForecastBatch
}

export const IMPORT_TYPES: StormImportType[] = [
  {
    id: 'google-weather-lab',
    label: 'Google Weather Lab',
    accept: '.csv',
    parse: parseGoogleWeatherLabCsv,
  },
]
