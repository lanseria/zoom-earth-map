// server/api/proxy/boundaries.json.ts

export default defineEventHandler(async (event) => {
  const geoJsonUrl = 'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json'

  try {
    // 使用 $fetch 从目标服务器获取数据
    // 在服务端，$fetch 不会遇到浏览器同源策略的限制
    const data = await $fetch(geoJsonUrl, {
      // 告诉 $fetch 我们期望得到原始文本，而不是自动解析的JSON
      // 这可以避免潜在的解析问题，并直接将原始数据流式传输给客户端
      responseType: 'json',
    })

    // (可选，但推荐) 设置缓存头，让浏览器和CDN缓存这个响应
    // 这个 GeoJSON 文件是静态的，不会经常改变，缓存一天（86400秒）是合理的
    event.node.res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400')

    return data
  }
  catch (error) {
    console.error('代理 GeoJSON 失败:', error)
    // 如果获取失败，向客户端返回一个错误
    throw createError({
      statusCode: 502, // Bad Gateway，表示代理服务器从上游收到了无效响应
      statusMessage: '无法获取地理边界数据',
    })
  }
})
