// 차트 공통 테마 — 대시보드의 모든 차트가 색·축·그리드·툴팁 설정을 이 모듈에서만 가져온다.
//
// 왜 한 곳에 모으는가
//  - 차트마다 색/폰트/그리드를 따로 적으면 조금씩 어긋나고, 새 차트를 추가할 때 또 어긋난다.
//  - 여기만 고치면 5개 차트가 한꺼번에 따라온다.
//
// 이 모듈은 **표현(presentation)만** 담당한다. 집계·계산은 utils/aggregate.ts가 단독으로 책임진다.
import { formatKRW, formatKRWCompact, formatPercent } from './format'

// ─────────────────────────────────────────────────────────────
// 서피스 / 잉크 토큰
// 카드 배경(흰색)과 tailwind slate 스케일에 맞춘 값. 텍스트는 절대 시리즈 색을 입지 않는다.
// ─────────────────────────────────────────────────────────────
export const SURFACE = '#ffffff'          // 카드 배경 = 마크 사이 여백 색
export const INK_PRIMARY = '#0f172a'       // slate-900
export const INK_SECONDARY = '#475569'     // slate-600
export const INK_MUTED = '#94a3b8'         // slate-400
export const GRID_LINE = '#f1f5f9'         // slate-100 — 헤어라인, 실선, 후퇴색
export const AXIS_LINE = '#e2e8f0'         // slate-200 — 축 기준선

// ─────────────────────────────────────────────────────────────
// 카테고리(identity) 팔레트 — 고정 8슬롯
//
// 슬롯 순서 자체가 색약 안전성 장치다. 순서를 바꾸거나 9번째 색을 만들어 쓰지 않는다.
// 8개를 넘는 항목은 '기타'로 묶어 중립 회색(OTHER_COLOR)을 쓴다.
//
// 검증 결과(흰 배경 / light):
//   명도대역 PASS · 채도하한 PASS
//   색약 인접쌍 최소 ΔE 9.1 (목표 8 이상) · 일반시야 인접쌍 최소 ΔE 19.6 (하한 15)
//   대비 3:1 미달 3슬롯(#1baf7a·#eda100·#e87ba4) → 이름+금액이 보이는 HTML 범례와
//   거래내역 표가 보조 채널로 항상 함께 제공되므로 허용된다.
// 1번 슬롯은 대시보드 기본색(brand-600)이라 카드·버튼과 같은 톤으로 읽힌다.
// ─────────────────────────────────────────────────────────────
export const CATEGORICAL: readonly string[] = [
  '#1a5eeb', // 1 blue   (brand-600)
  '#eb6834', // 2 orange
  '#1baf7a', // 3 aqua
  '#eda100', // 4 yellow
  '#e87ba4', // 5 magenta
  '#008300', // 6 green
  '#4a3aa7', // 7 violet
  '#e34948'  // 8 red
]

/** '기타 / 그 외' 묶음 전용 중립 회색 — identity 색이 아니므로 슬롯을 쓰지 않는다 */
export const OTHER_COLOR = '#94a3b8'       // slate-400

/** 단일 시리즈(명목형 막대)용 기본색 — 길이가 이미 크기를 말하므로 색은 하나면 된다 */
export const SINGLE_SERIES = CATEGORICAL[0]
/** 미터(진행바)의 빈 트랙 — 같은 계열의 밝은 단계 */
export const SINGLE_SERIES_TRACK = '#d9eaff'  // brand-100

// ─────────────────────────────────────────────────────────────
// 의미가 고정된 색 — 고정비 / 변동비
// 이 두 색은 identity가 아니라 뜻을 가진 짝이므로 카테고리 슬롯과 별도로 둔다.
// (KPI 카드의 brand-700 / amber-600 텍스트와 같은 계열이라 화면 전체가 같은 언어를 쓴다)
// 검증: 색약 ΔE 32.8 · 일반시야 ΔE 39.5 · 둘 다 대비 3:1 이상 PASS
// ─────────────────────────────────────────────────────────────
export const FIXED_COLOR = '#1a5eeb'       // 고정비 — brand-600
export const VARIABLE_COLOR = '#d97706'    // 변동비 — amber-600

// ─────────────────────────────────────────────────────────────
// HTML 범례 항목 — components/charts/Legend.vue가 받는 모양
// (Chart.js 내장 범례 대신 쓰는 이유는 Legend.vue 주석 참고)
// ─────────────────────────────────────────────────────────────
export interface LegendItem {
  label: string
  color: string
  /** 이미 포맷된 값 문자열 (예: ₩1,234,000) */
  value?: string
  /** 비중 등 보조 텍스트 */
  hint?: string
  /** 숨김 상태 */
  hidden?: boolean
}

// ─────────────────────────────────────────────────────────────
// 마크 스펙 — 전 차트 공통
// ─────────────────────────────────────────────────────────────
/** 막대 최대 두께. 슬롯을 꽉 채우지 않고 여백을 남긴다 */
export const BAR_THICKNESS = 24
/** 데이터가 끝나는 쪽 모서리 라운드 (기준선 쪽은 각지게) */
export const BAR_RADIUS = 4
/** 맞닿은 마크를 가르는 여백 — 테두리가 아니라 '배경색 틈'이다 */
export const SURFACE_GAP = 2

// ─────────────────────────────────────────────────────────────
// 카테고리 → 색 배정
//
// **색은 순위가 아니라 항목을 따라간다.** 예전에는 정렬된 순서(index)로 색을 줬기 때문에
// 기간 필터를 바꿔 순위가 흔들리면 '식비'가 파랑에서 초록으로 변했다. 여기서는 설정 화면의
// 카테고리 목록 순서(사용자가 정하는 고정 순서)를 기준으로 슬롯을 배정하므로,
// 금액이 바뀌어도 같은 카테고리는 같은 색을 유지한다.
// ─────────────────────────────────────────────────────────────

/** 도넛에서 나머지를 묶을 때 쓰는 라벨 */
export const OTHERS_LABEL = '기타 (그 외)'

export interface CategoryColorOptions {
  /** 설정 화면의 카테고리 순서 — 색 배정의 기준이 되는 고정 순서 */
  order?: readonly string[]
  /** 이 인덱스는 '나머지' 묶음이므로 중립 회색을 준다 (도넛/스택의 마지막 항목) */
  othersIndex?: number
}

/**
 * 주어진 라벨들에 카테고리 색을 배정한다.
 *
 * - 배정 순서는 `order`(설정 화면 순서) 기준이므로 금액 순위와 무관하다.
 * - 한 차트 안에서 같은 색이 두 번 나오지 않는다 (슬롯을 순서대로 하나씩 소비).
 * - 8슬롯을 넘으면 새 색을 만들지 않고 중립 회색으로 떨어뜨린다.
 */
export function categoryColors(labels: string[], opts: CategoryColorOptions = {}): string[] {
  const order = opts.order ?? []
  const rank = new Map<string, number>()
  order.forEach((name, i) => rank.set(name, i))

  // 나머지 묶음은 슬롯을 소비하지 않는다
  const identityIdx = labels
    .map((_, i) => i)
    .filter((i) => i !== opts.othersIndex)

  // 고정 순서(설정 화면 순서 → 없으면 이름순)로 줄 세운 뒤 슬롯을 순서대로 배정
  const sorted = [...identityIdx].sort((a, b) => {
    const ra = rank.get(labels[a]) ?? Number.MAX_SAFE_INTEGER
    const rb = rank.get(labels[b]) ?? Number.MAX_SAFE_INTEGER
    if (ra !== rb) return ra - rb
    return labels[a].localeCompare(labels[b], 'ko-KR')
  })

  const out = new Array<string>(labels.length).fill(OTHER_COLOR)
  sorted.forEach((labelIdx, slot) => {
    out[labelIdx] = slot < CATEGORICAL.length ? CATEGORICAL[slot] : OTHER_COLOR
  })
  return out
}

// ─────────────────────────────────────────────────────────────
// 공통 Chart.js 옵션
// ─────────────────────────────────────────────────────────────

/** 툴팁 공통 모양 — 값이 주인공, 항목 이름은 보조 */
function tooltipBase() {
  return {
    backgroundColor: 'rgba(15, 23, 42, 0.94)',   // slate-900
    titleColor: '#f8fafc',
    titleFont: { size: 12, weight: 600 as const },
    bodyColor: '#f1f5f9',
    bodyFont: { size: 13, weight: 600 as const },
    footerColor: '#cbd5e1',
    footerFont: { size: 11, weight: 500 as const },
    padding: { top: 10, right: 12, bottom: 10, left: 12 },
    cornerRadius: 8,
    displayColors: true,
    usePointStyle: true,
    boxPadding: 6,
    caretSize: 5,
    // 데이터가 없는 항목(0원)은 툴팁에서 감춰 목록이 늘어지지 않게 한다
    filter: (ctx: any) => Number(ctx.parsed?.y ?? ctx.parsed?.x ?? ctx.parsed) !== 0
  }
}

/** 모든 차트의 기본 골격 — 반응형, 내장 범례 off(HTML 범례 사용) */
export function baseOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    // 막대/조각은 마크 자체가 hit target이다
    interaction: { mode: 'nearest' as const, intersect: true },
    animation: { duration: 220 },
    layout: { padding: { top: 4, right: 4, bottom: 0, left: 0 } },
    plugins: {
      legend: { display: false },   // 카드 상단 HTML 범례가 대신한다
      tooltip: tooltipBase()
    }
  }
}

export interface BarScaleOptions {
  /** 누적 막대 여부 */
  stacked?: boolean
  /** 가로 막대(indexAxis:'y') 여부 */
  horizontal?: boolean
  /** 값 축 눈금 최대 개수 */
  valueTicks?: number
  /** 범주 축 눈금 최대 개수 (많은 기간 라벨이 겹치지 않게) */
  categoryTicks?: number
}

/** 막대차트 축 — 값 축엔 헤어라인 그리드, 범주 축은 그리드 없음 */
export function barScales(opts: BarScaleOptions = {}) {
  const { stacked = false, horizontal = false, valueTicks = 5, categoryTicks } = opts

  const valueAxis = {
    stacked,
    border: { display: false },
    grid: { color: GRID_LINE, drawTicks: false, lineWidth: 1 },
    ticks: {
      color: INK_MUTED,
      font: { size: 11 },
      padding: 8,
      maxTicksLimit: valueTicks,
      callback: (v: number | string) => formatKRWCompact(Number(v))
    }
  }

  const categoryAxis = {
    stacked,
    border: { color: AXIS_LINE, width: 1 },
    grid: { display: false },
    ticks: {
      color: INK_SECONDARY,
      font: { size: 11 },
      padding: 6,
      // 라벨은 절대 회전시키지 않는다 — 대신 자동으로 건너뛴다(가독성 우선)
      autoSkip: true,
      maxRotation: 0,
      minRotation: 0,
      ...(categoryTicks ? { maxTicksLimit: categoryTicks } : {})
    }
  }

  return horizontal
    ? { x: valueAxis, y: categoryAxis }
    : { x: categoryAxis, y: valueAxis }
}

/** 누적 막대 세그먼트 공통 — 기준선은 각지게, 위쪽은 라운드 + 배경색 틈 */
export function stackedBarSegment(color: string, label: string, stack = 'total') {
  return {
    label,
    backgroundColor: color,
    stack,
    borderRadius: BAR_RADIUS,
    borderSkipped: 'bottom' as const,
    // 테두리가 아니라 세그먼트를 가르는 '배경색 틈'
    borderColor: SURFACE,
    borderWidth: { top: SURFACE_GAP, right: 0, bottom: 0, left: 0 },
    maxBarThickness: BAR_THICKNESS
  }
}

/** 도넛 공통 — 조각 사이 배경색 틈, 가운데 라벨이 들어갈 만큼 넉넉한 cutout */
export function donutDataset(colors: string[]) {
  return {
    backgroundColor: colors,
    borderColor: SURFACE,
    borderWidth: SURFACE_GAP,
    hoverBorderColor: SURFACE,
    hoverOffset: 6,
    spacing: 0
  }
}

/** 통화 툴팁 (세로 막대) */
export function currencyTooltipY() {
  return {
    ...tooltipBase(),
    callbacks: {
      label: (ctx: any) => `  ${ctx.dataset.label}  ${formatKRW(ctx.parsed.y)}`
    }
  }
}

/** 통화 툴팁 (가로 막대) — 단일 시리즈라 항목 이름은 제목에 있다 */
export function currencyTooltipX(shareOf?: () => number) {
  return {
    ...tooltipBase(),
    displayColors: false,
    callbacks: {
      label: (ctx: any) => {
        const v = Number(ctx.parsed.x) || 0
        const total = shareOf?.() ?? 0
        return total > 0
          ? `  ${formatKRW(v)} · ${formatPercent((v / total) * 100)}`
          : `  ${formatKRW(v)}`
      }
    }
  }
}

/** 부분-전체 툴팁 (도넛) — 금액과 비중을 함께 */
export function shareTooltip() {
  return {
    ...tooltipBase(),
    callbacks: {
      label: (ctx: any) => {
        const data = (ctx.dataset.data as number[]) ?? []
        const total = data.reduce((a, b) => a + (Number(b) || 0), 0) || 1
        const v = Number(ctx.parsed) || 0
        return `  ${formatKRW(v)} · ${formatPercent((v / total) * 100)}`
      }
    }
  }
}

/**
 * 가로 막대 끝에 값을 직접 적는 플러그인.
 *
 * 툴팁은 "보조"이지 "유일한 통로"가 되면 안 된다. 항목이 적은 가로 막대는 끝에 값을 적어두면
 * 마우스를 올리지 않고도 읽힌다. 단, **들어갈 자리가 없으면 그리지 않는다** —
 * 잘린 글자는 없는 것보다 나쁘고, 그 값은 툴팁과 거래내역 표에 그대로 남아 있다.
 * (누적 막대의 중간 세그먼트에는 쓰지 않는다. 끝이 없어 라벨이 겹친다)
 */
export const barTipLabels = {
  id: 'barTipLabels',
  afterDatasetsDraw(chart: any) {
    const { ctx, chartArea } = chart
    const meta = chart.getDatasetMeta(0)
    if (!meta || meta.hidden) return

    ctx.save()
    ctx.font = "600 11px Pretendard, system-ui, 'Noto Sans KR', sans-serif"
    ctx.fillStyle = INK_SECONDARY
    ctx.textBaseline = 'middle'

    const data = chart.data.datasets[0]?.data ?? []
    meta.data.forEach((bar: any, i: number) => {
      const value = Number(data[i]) || 0
      if (value <= 0) return
      const text = formatKRWCompact(value)
      const width = ctx.measureText(text).width
      const gap = 6
      // 막대 오른쪽에 글자가 들어갈 여유가 있을 때만 그린다
      if (bar.x + gap + width > chartArea.right) return
      ctx.textAlign = 'left'
      ctx.fillText(text, bar.x + gap, bar.y)
    })
    ctx.restore()
  }
}

/** 누적 막대 툴팁에 붙는 합계 푸터 — "이 기간 총 얼마"를 바로 알 수 있게 */
export function stackTotalFooter() {
  return (items: any[]) => {
    if (!items?.length) return ''
    const sum = items.reduce((s, it) => s + (Number(it.parsed?.y) || 0), 0)
    return `합계 ${formatKRW(sum)}`
  }
}
