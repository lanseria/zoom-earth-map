import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const assets = [
  {
    url: 'https://ghfast.top/https://raw.githubusercontent.com/nvkelso/natural-earth-vector/refs/heads/master/geojson/ne_50m_land.geojson',
    dest: 'public/assets/ne_50m_land.geojson',
  },
]

async function downloadWithFetch(url, dest) {
  if (existsSync(dest)) {
    console.log(`[skip] ${dest} already exists`)
    return
  }

  mkdirSync(dirname(dest), { recursive: true })
  console.log(`[downloading] ${url} -> ${dest}`)

  const res = await fetch(url)
  if (!res.ok)
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`)

  const buffer = Buffer.from(await res.arrayBuffer())
  writeFileSync(dest, buffer)
  console.log(`[done] ${dest} (${(buffer.length / 1024).toFixed(1)} KB)`)
}

await Promise.all(assets.map(a => downloadWithFetch(a.url, a.dest)))
