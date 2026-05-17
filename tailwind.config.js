/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './components/**/*.{vue,js,ts}',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './app.vue',
    './composables/**/*.{js,ts}',
    './utils/**/*.{js,ts}'
  ],
  theme: {
    // Tailwind 기본(sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536) 위에
    // 흔한 한국 사용자 환경(1366×768 노트북, 1920 FHD, 2560 QHD, 3840 4K)을
    // 더 세밀하게 다루기 위한 추가 브레이크포인트.
    //   xs   : 360 — 좁은 모바일에서 컴팩트화 트리거
    //   3xl  : 1792 — FHD 이상에서 본문 폭/그리드 확장
    //   4xl  : 2240 — QHD/2.5K
    //   5xl  : 2880 — 4K/울트라와이드
    screens: {
      xs: '360px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
      '3xl': '1792px',
      '4xl': '2240px',
      '5xl': '2880px'
    },
    extend: {
      colors: {
        brand: {
          50:  '#eef6ff',
          100: '#d9eaff',
          200: '#bcdcff',
          300: '#8ec3ff',
          400: '#599eff',
          500: '#2f7bff',
          600: '#1a5eeb',
          700: '#1749bf',
          800: '#183e98',
          900: '#17377a'
        }
      },
      // 본문 컨테이너용 max-width 단계
      // 화면 폭에 따라 자연스럽게 늘어나도록 fluid 토큰을 같이 둔다.
      maxWidth: {
        'screen-3xl': '1792px',
        'screen-4xl': '2240px',
        'screen-5xl': '2880px',
        // 양옆 여백 4vw씩만 두고 최대 2400px까지 확장 — 4K에서도 양옆이 비지 않도록
        'content-fluid': 'min(96vw, 2400px)'
      },
      // 차트 영역 높이 토큰
      // 모바일/랜드스케이프에서 vh가 너무 작아도 충분히 보이도록 min을 넉넉히 잡고
      // 데스크톱에서는 vh 비례로 확장, 4K에서는 max로 캡 한다.
      // - chart-sm (도넛): 작아도 둥글게 보이는 정도 ~ 와이드에서 너무 커지지 않게
      // - chart-md (메인 막대): 모바일에서도 막대 라벨이 잘 보이는 320 이상 보장
      // - chart-lg (크게 보이는 행): FHD/QHD에서 큰 화면을 활용
      height: {
        'chart-sm': 'clamp(260px, 32vh, 340px)',
        'chart-md': 'clamp(320px, 42vh, 440px)',
        'chart-lg': 'clamp(360px, 50vh, 540px)'
      },
      minHeight: {
        'chart-sm': 'clamp(260px, 32vh, 340px)',
        'chart-md': 'clamp(320px, 42vh, 440px)',
        'chart-lg': 'clamp(360px, 50vh, 540px)'
      },
      // fluid spacing — 좁은 화면에선 줄어들고 큰 화면에선 적절히 커진다
      spacing: {
        'fluid-2': 'clamp(0.5rem, 0.4rem + 0.4vw, 0.875rem)',
        'fluid-3': 'clamp(0.75rem, 0.55rem + 0.6vw, 1.25rem)',
        'fluid-4': 'clamp(1rem, 0.7rem + 0.9vw, 1.75rem)',
        'fluid-6': 'clamp(1.25rem, 0.85rem + 1.2vw, 2.5rem)'
      },
      fontFamily: {
        sans: [
          'Pretendard',
          '-apple-system',
          'BlinkMacSystemFont',
          'system-ui',
          'Roboto',
          'Helvetica Neue',
          'Segoe UI',
          'Apple SD Gothic Neo',
          'Noto Sans KR',
          'Malgun Gothic',
          'sans-serif'
        ]
      }
    }
  },
  plugins: []
}
