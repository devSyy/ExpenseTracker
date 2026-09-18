// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: { enabled: true },
  modules: ['@nuxtjs/tailwindcss'],
  ssr: false, // 클라이언트에서만 파일 파싱하므로 SPA 모드가 간단합니다

  /*
   * nitro preset을 여기 고정하지 않는다.
   *
   * 이 프로젝트는 배포 대상이 둘이다:
   *  - Docker(self-hosted): `npm run build` → Node 서버 출력(.output/server)
   *  - GitHub Pages:        `npm run generate` + NITRO_PRESET=github-pages → 정적 출력(.output/public)
   *
   * preset을 config에 박으면 Nitro가 환경변수보다 config를 우선하므로
   * Docker 빌드까지 정적 출력으로 바뀌어 `node output/server/index.mjs`가 죽는다.
   * 그래서 Pages 배포 스크립트(gh-pages-deploy.bat)에서만 NITRO_PRESET을 준다.
   * 그 preset이 .nojekyll 생성(_nuxt 폴더가 Jekyll에 먹히는 것 방지)과
   * /404.html 프리렌더(딥링크 새로고침 시 SPA 복구)를 대신해 준다.
   */

  app: {
    /*
     * Project Pages는 https://<user>.github.io/<repo>/ 아래에 놓이므로
     * 자산·라우트 경로 앞에 저장소 이름이 붙어야 한다.
     * 하드코딩하지 않고 환경변수로 받는 이유: 로컬 `npm run dev`와
     * Docker 배포는 루트('/')에서 돌아야 하기 때문이다.
     * 배포 시에는 NUXT_APP_BASE_URL=/ExpenseTracker/ 를 주고 generate 한다.
     */
    baseURL: process.env.NUXT_APP_BASE_URL || '/',
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
