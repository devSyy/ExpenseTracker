// Chart.js 를 클라이언트에서 전역 등록
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  BarElement,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Filler
} from 'chart.js'

export default defineNuxtPlugin(() => {
  ChartJS.register(
    Title,
    Tooltip,
    Legend,
    ArcElement,
    BarElement,
    LineElement,
    PointElement,
    CategoryScale,
    LinearScale,
    Filler
  )
  // 한국어 친화 기본 설정
  ChartJS.defaults.font.family =
    "Pretendard, -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif"
  ChartJS.defaults.color = '#475569'
})
