import { appDescription } from './app/constants/index'

export default defineNuxtConfig({
  modules: [
    '@vueuse/nuxt',
    '@unocss/nuxt',
    '@pinia/nuxt',
    '@nuxtjs/color-mode',
    '@nuxt/eslint',
  ],

  ssr: false,

  devtools: {
    enabled: false,
  },

  app: {
    head: {
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' },
      ],
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: appDescription },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'theme-color', media: '(prefers-color-scheme: light)', content: 'white' },
        { name: 'theme-color', media: '(prefers-color-scheme: dark)', content: '#222222' },
      ],
    },
  },

  colorMode: {
    classSuffix: '',
  },

  // 定义运行时配置
  runtimeConfig: {
    // public 下的变量会暴露给前端
    public: {
      gisServerUrl: '',
      mapTilerKey: '',
      tdtKey: '',
      // 城市点击跳转的天气详情页地址（形如 https://host:3030/?lat=...&lon=...&name=...）
      cityDetailUrl: '',
      // 火烧云 glow-index 查询 API 地址（形如 https://host:8002/api/glow-index）
      glowIndexApiUrl: '',
    },
  },

  devServer: {
    port: 19998,
  },

  vite: {
    // maplibre-gl v6 为纯 ESM 且通过 new URL('./maplibre-gl-worker.mjs', import.meta.url)
    // 引用同目录的 worker/shared 分包；依赖预构建会把主包搬进缓存目录导致相对路径失效
    //（worker 请求落到 SPA 回退页，所有 GeoJSON/矢量图层静默消失），故排除出预构建。
    optimizeDeps: {
      exclude: ['maplibre-gl'],
    },
    // maplibre 以 { type: 'module' } 创建 worker，worker 资源需以 ES 格式打包
    worker: {
      format: 'es',
    },
  },

  future: {
    compatibilityVersion: 4,
  },

  experimental: {
    // when using generate, payload js assets included in sw precache manifest
    // but missing on offline, disabling extraction it until fixed
    payloadExtraction: false,
    renderJsonPayloads: true,
    typedPages: true,
  },

  compatibilityDate: '2024-08-14',
  nitro: {
    esbuild: {
      options: {
        target: 'esnext',
      },
    },
    prerender: {
      crawlLinks: false,
      routes: ['/'],
    },
  },
  eslint: {
    config: {
      standalone: false,
      nuxt: {
        sortConfigKeys: true,
      },
    },
  },

})
