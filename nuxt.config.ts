// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: { enabled: true },
  modules: ['@nuxtjs/tailwindcss'],
  ssr: false, // 클라이언트에서만 파일 파싱하므로 SPA 모드가 간단합니다
  app: {
    head: {
      title: '가계부 대시보드',
      htmlAttrs: { lang: 'ko' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: '엑셀 파일을 업로드하면 가계 지출을 자동 분류하고 시각화합니다.' }
      ]
    }
  },
  typescript: {
    strict: true,
    typeCheck: false
  },
  tailwindcss: {
    viewer: false
  }
})
