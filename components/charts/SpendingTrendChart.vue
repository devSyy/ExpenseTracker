<script setup lang="ts">
// 지출 추이 — 일/주/월/분기/반기/년도 단위 지출 합계와 목표선.
//  · 일: 선택한 달의 누적 지출 vs 월 목표 균등 배분 페이스선
//  · 주: 월 목표 × 12 ÷ 52 참고선만 그린다 (주 목표는 없으므로 '초과' 판정은 하지 않는다)
//  · 월·분기·반기·년: 막대 + 목표 점선. 초과는 빨강 + "초과" 텍스트, 진행 중 기간은 옅게.
// 판정 색은 색만으로 말하지 않는다 — 범례·툴팁·표에 같은 내용이 글자로 나온다.
import { computed, ref, watch } from 'vue'
import { Bar } from 'vue-chartjs'
import { Chart as ChartJS, BarController, LineController } from 'chart.js'
import {
  INK_SECONDARY,
  OVER_COLOR,
  SINGLE_SERIES,
  BAR_RADIUS,
  BAR_THICKNESS,
  baseOptions,
  barScales,
  currencyTooltipY,
  withAlpha,
  type LegendItem
} from '~/utils/chartTheme'
import { formatKRW } from '~/utils/format'
import {
  TREND_UNITS,
  buildPeriods,
  dailySeries,
  dayKey,
  periodStatus,
  targetFor,
  type DayMap,
  type SpendingGoals,
  type TrendUnit
} from '~/utils/spendingGoals'

// 혼합(막대+선) 차트에 필요한 컨트롤러 — 전역 기본값은 건드리지 않고 등록만 한다
ChartJS.register(BarController, LineController)

const props = defineProps<{
  goals: SpendingGoals
  dayMap: DayMap
  firstYear: number
  today: Date
}>()

const unit = ref<TrendUnit>('month')
const tableView = ref(false)
const won = (n: number) => formatKRW(Math.round(n))
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatKRW(Math.abs(Math.round(n)))}`
const ymd = (d: Date) => dayKey(d).slice(2).replaceAll('-', '.')

// ── 일별: 조회할 달 (최근 12개월) ──
const monthOptions = computed(() => {
  const out: { value: string; label: string }[] = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(props.today.getFullYear(), props.today.getMonth() - i, 1)
    out.push({ value: `${d.getFullYear()}-${d.getMonth() + 1}`, label: `${d.getFullYear()}년 ${d.getMonth() + 1}월` })
  }
  return out
})
const dayMonth = ref('')
watch(monthOptions, (o) => { if (!o.some((x) => x.value === dayMonth.value)) dayMonth.value = o[0].value }, { immediate: true })

const isDay = computed(() => unit.value === 'day')
const isWeek = computed(() => unit.value === 'week')
const target = computed(() => targetFor(props.goals, unit.value))

// ── 막대(주·월·분기·반기·년) ──
const periods = computed(() =>
  isDay.value ? [] : buildPeriods(unit.value as Exclude<TrendUnit, 'day'>, props.dayMap, props.today, props.firstYear)
)
// 주는 참고선만 있으므로 over 판정을 하지 않는다 (시각적 비교만)
const statuses = computed(() =>
  periods.value.map((p) => (isWeek.value ? (p.inProgress ? 'prog' : 'ok') : periodStatus(p, target.value)))
)
const barColors = computed(() =>
  periods.value.map((p, i) => {
    const over = statuses.value[i] === 'over'
    const base = over ? OVER_COLOR : SINGLE_SERIES
    return p.inProgress ? withAlpha(base, over ? 0.6 : 0.4) : base
  })
)

// ── 일별 ──
const daily = computed(() => {
  const [y, m] = dayMonth.value.split('-').map(Number)
  return dailySeries(y, m, props.dayMap, props.today, target.value)
})
const dayMonthNo = computed(() => Number(dayMonth.value.split('-')[1]))

const rangeText = computed(() => {
  switch (unit.value) {
    case 'day': return `${monthOptions.value.find((o) => o.value === dayMonth.value)?.label ?? ''} · 일별 누적 지출`
    case 'week': return '최근 12주 · 주별 지출 합계'
    case 'month': return '최근 12개월 · 월별 지출 합계'
    case 'quarter': return '최근 8분기 · 분기별 지출 합계'
    case 'half': return '최근 6반기 · 반기별 지출 합계'
    default: return '전체 기간 · 연도별 지출 합계'
  }
})
const subtitle = computed(() => {
  const t = target.value
  if (!t) return `${rangeText.value} · 목표 미설정`
  if (isDay.value) return `${rangeText.value} · 점선은 월 목표 ${won(t)}를 하루씩 균등 배분한 페이스선`
  if (isWeek.value) return `${rangeText.value} · 점선은 월 목표 환산 참고선 ${won(t)} (목표 아님)`
  return `${rangeText.value} · 점선은 목표 ${won(t)}`
})

const hasAnyData = computed(() => props.dayMap.size > 0)

// ── 범례 (HTML) ──
const legendItems = computed<LegendItem[]>(() => {
  const t = target.value
  if (isDay.value) {
    return [
      { label: '누적 지출', color: SINGLE_SERIES },
      ...(t ? [{ label: '목표 초과 구간', color: OVER_COLOR }, { label: '목표 페이스', color: INK_SECONDARY }] : [])
    ]
  }
  const items: LegendItem[] = [{ label: t && !isWeek.value ? '목표 이내' : '지출', color: SINGLE_SERIES }]
  if (t && !isWeek.value) items.push({ label: '목표 초과', color: OVER_COLOR })
  items.push({ label: '진행 중인 기간', color: withAlpha(SINGLE_SERIES, 0.4) })
  if (t) items.push({ label: isWeek.value ? '월 목표 환산 (참고)' : '목표', color: INK_SECONDARY })
  return items
})

// ── 통계 ──
const stats = computed<[string, string][]>(() => {
  const t = target.value
  if (isDay.value) {
    const d = daily.value
    const avg = d.elapsed ? d.total / d.elapsed : 0
    const proj = d.inProgress ? avg * d.nDays : d.total
    return [
      ['누적 지출', won(d.total)],
      ['일평균', won(avg)],
      [d.inProgress ? '이 속도면 월말 예상' : '월 합계', t ? `${won(proj)} (${Math.round((proj / t) * 100)}%)` : won(proj)],
      ['페이스 대비', t ? signed(d.total - (t * d.elapsed) / d.nDays) : '–']
    ]
  }
  const list = periods.value
  if (!list.length) return []
  const done = list.filter((p) => !p.inProgress)
  const avg = done.length ? done.reduce((s, p) => s + p.total, 0) / done.length : 0
  const mx = list.reduce((a, p) => (p.total > a.total ? p : a), list[0])
  const unitName = { week: '주', month: '개월', quarter: '분기', half: '반기', year: '년' }[unit.value as string] ?? ''
  const overN = t && !isWeek.value ? statuses.value.filter((s) => s === 'over').length : 0
  return [
    ['표시 구간 합계', won(list.reduce((s, p) => s + p.total, 0))],
    ['완료 기간 평균', won(avg)],
    ['최대 지출', `${mx.label} · ${won(mx.total)}`],
    ['목표 초과', t && !isWeek.value ? `${overN} / ${list.length}${unitName}` : '–']
  ]
})

// ── 차트 데이터 ──
const chartData = computed<any>(() => {
  const t = target.value
  if (isDay.value) {
    const d = daily.value
    return {
      labels: d.labels,
      datasets: [
        {
          type: 'line', label: '누적 지출', data: d.cumulative,
          borderColor: SINGLE_SERIES, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5,
          pointHoverBackgroundColor: SINGLE_SERIES, pointHoverBorderColor: '#ffffff', pointHoverBorderWidth: 2,
          tension: 0, spanGaps: false, order: 1,
          segment: { borderColor: (c: any) => (t && c.p1.parsed.y > t ? OVER_COLOR : SINGLE_SERIES) }
        },
        ...(t ? [{
          type: 'line', label: '목표 페이스', data: d.pace,
          borderColor: INK_SECONDARY, borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0, order: 2
        }] : [])
      ]
    }
  }
  const list = periods.value
  return {
    labels: list.map((p) => p.label),
    datasets: [
      {
        type: 'bar', label: '지출', data: list.map((p) => p.total),
        backgroundColor: barColors.value, hoverBackgroundColor: barColors.value,
        hoverBorderColor: '#0f172a', hoverBorderWidth: 1.5, borderWidth: 0,
        maxBarThickness: BAR_THICKNESS, borderRadius: { topLeft: BAR_RADIUS, topRight: BAR_RADIUS },
        borderSkipped: 'bottom', order: 2
      },
      ...(t ? [{
        type: 'line', label: '목표', data: list.map(() => t),
        borderColor: INK_SECONDARY, borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0, order: 1
      }] : [])
    ]
  }
})

const chartOptions = computed<any>(() => {
  const base = baseOptions()
  const tip = currencyTooltipY()
  const t = target.value
  const scales: any = barScales({ categoryTicks: isDay.value ? 16 : 12 })
  scales.y.beginAtZero = true
  if (isDay.value && t) scales.y.suggestedMax = t
  if (isDay.value) scales.x.ticks.callback = (_: any, i: number) => `${daily.value.labels[i]}일`

  const callbacks = isDay.value
    ? {
        title: (items: any[]) => `${dayMonthNo.value}월 ${items[0].dataIndex + 1}일`,
        label: (item: any) => {
          const d = daily.value
          const i = item.dataIndex
          const lines = [`누적 ${won(d.cumulative[i] ?? 0)}`, `이 날 지출 ${won(d.daily[i] ?? 0)}`]
          if (t) {
            const diff = (d.cumulative[i] ?? 0) - (d.pace[i] ?? 0)
            lines.push(`페이스 ${won(d.pace[i] ?? 0)} 대비 ${diff > 0 ? '▲ ' : '✓ '}${signed(diff)}`)
            if ((d.cumulative[i] ?? 0) > t) lines.push(`▲ 월 목표 초과 ${signed((d.cumulative[i] ?? 0) - t)}`)
          }
          return lines
        }
      }
    : {
        title: (items: any[]) => {
          const p = periods.value[items[0].dataIndex]
          return `${p.label}  (${ymd(p.start)} ~ ${ymd(p.end)})`
        },
        label: (item: any) => {
          const i = item.dataIndex
          const p = periods.value[i]
          const s = statuses.value[i]
          const lines = [`지출 ${won(p.total)} · ${p.count.toLocaleString('ko-KR')}건`]
          if (t) {
            lines.push(`${isWeek.value ? '월 목표 환산' : '목표'} ${won(t)} 대비 ${Math.round((p.total / t) * 100)}%`)
            if (!isWeek.value && s === 'over') lines.push(`▲ 초과 ${signed(p.total - t)}`)
            else if (p.inProgress) lines.push(`진행 중 · 경과 ${p.elapsed}/${p.days}일`)
            else if (!isWeek.value) lines.push(`✓ 여유 ${won(t - p.total)}`)
          } else if (p.inProgress) lines.push(`진행 중 · 경과 ${p.elapsed}/${p.days}일`)
          return lines
        }
      }

  return {
    ...base,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      ...base.plugins,
      tooltip: {
        ...tip,
        displayColors: false,
        filter: (it: any) => it.datasetIndex === 0 && it.raw != null,
        callbacks
      }
    },
    scales
  }
})

// ── 표 보기 ──
interface Row { cells: string[]; badge: { text: string; kind: 'ok' | 'over' | 'warn' | 'prog' | 'none' } }
const tableHead = computed(() => isDay.value ? ['일', '일 지출', '누적', '페이스', '페이스 대비'] : ['기간', '지출', '건수', '목표', '달성률', '상태'])
const tableRows = computed<Row[]>(() => {
  const t = target.value
  if (isDay.value) {
    const d = daily.value
    const rows: Row[] = []
    d.labels.forEach((day, i) => {
      if (d.daily[i] == null) return
      const cum = d.cumulative[i] ?? 0
      const pace = d.pace[i]
      const diff = pace == null ? 0 : cum - pace
      rows.push({
        cells: [`${dayMonthNo.value}/${day}`, won(d.daily[i] ?? 0), won(cum), pace == null ? '–' : won(pace)],
        badge: !t ? { text: '–', kind: 'none' }
          : diff > 0 ? { text: `▲ ${signed(diff)}`, kind: cum > t ? 'over' : 'warn' }
          : { text: `✓ ${signed(diff)}`, kind: 'ok' }
      })
    })
    return rows
  }
  return periods.value.map((p, i) => {
    const s = statuses.value[i]
    return {
      cells: [p.label, won(p.total), `${p.count.toLocaleString('ko-KR')}건`, t ? won(t) : '–', t ? `${Math.round((p.total / t) * 100)}%` : '–'],
      badge: !t ? { text: '–', kind: 'none' }
        : isWeek.value ? { text: p.inProgress ? '진행 중' : '참고', kind: 'prog' }
        : s === 'over' ? { text: `▲ 초과 ${signed(p.total - t)}`, kind: 'over' }
        : s === 'warn' ? { text: `▲ 페이스 초과`, kind: 'warn' }
        : s === 'prog' ? { text: '진행 중', kind: 'prog' }
        : { text: '✓ 이내', kind: 'ok' }
    }
  })
})
const badgeClass: Record<string, string> = {
  ok: 'bg-brand-50 text-brand-700',
  over: 'bg-rose-50 text-rose-700',
  warn: 'bg-amber-50 text-amber-800',
  prog: 'bg-slate-100 text-slate-600',
  none: 'text-slate-400'
}
</script>

<template>
  <ChartsCard
    title="지출 추이"
    :subtitle="subtitle"
    :empty="!hasAnyData"
    empty-text="지출 데이터가 없습니다. 대시보드에서 엑셀을 업로드하면 표시됩니다."
    body-class="h-chart-md xl:h-chart-lg"
  >
    <template #actions>
      <div class="flex flex-wrap items-center justify-end gap-2">
        <select
          v-if="isDay"
          v-model="dayMonth"
          class="form-input !w-auto !py-1 text-xs"
          aria-label="일별 조회 월"
        >
          <option v-for="o in monthOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <div class="seg-scroll">
          <div class="seg" role="radiogroup" aria-label="집계 단위">
            <button
              v-for="u in TREND_UNITS"
              :key="u.value"
              type="button"
              role="radio"
              :aria-checked="unit === u.value"
              :class="['seg-btn', unit === u.value ? 'is-active' : '']"
              @click="unit = u.value"
            >{{ u.label }}</button>
          </div>
        </div>
        <button
          type="button"
          class="seg-btn !bg-slate-100"
          :aria-pressed="tableView"
          @click="tableView = !tableView"
        >{{ tableView ? '차트로 보기' : '표로 보기' }}</button>
      </div>
    </template>

    <template #legend>
      <ChartsLegend :items="legendItems" />
    </template>

    <div v-if="tableView" class="h-full overflow-auto">
      <table class="w-full text-sm tabular-nums">
        <thead class="sticky top-0 bg-white">
          <tr class="text-xs text-slate-500">
            <th v-for="(h, i) in tableHead" :key="h" :class="['py-2 px-2 font-semibold border-b border-slate-100', i === 0 ? 'text-left' : 'text-right']">{{ h }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, ri) in tableRows" :key="ri" class="border-b border-slate-50">
            <td v-for="(c, ci) in r.cells" :key="ci" :class="['py-2 px-2', ci === 0 ? 'text-left text-slate-700' : 'text-right text-slate-900']">{{ c }}</td>
            <td class="py-2 px-2 text-right">
              <span :class="['inline-block rounded-full px-2 py-0.5 text-xs font-semibold', badgeClass[r.badge.kind]]">{{ r.badge.text }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="h-full" role="img" :aria-label="`${subtitle}. 자세한 값은 표로 보기에서 확인할 수 있습니다.`">
      <Bar :data="chartData" :options="chartOptions" />
    </div>

    <template #footer>
      <dl class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div v-for="[k, v] in stats" :key="k" class="min-w-0">
          <dt class="text-xs text-slate-500">{{ k }}</dt>
          <dd class="text-sm sm:text-base font-bold text-slate-900 tabular-nums truncate" :title="v">{{ v }}</dd>
        </div>
      </dl>
    </template>
  </ChartsCard>
</template>

<style scoped>
.seg-scroll { max-width: 100%; overflow-x: auto; scrollbar-width: none; }
.seg-scroll::-webkit-scrollbar { display: none; }
.seg { display: inline-flex; padding: 2px; gap: 2px; border-radius: 9px; background: rgb(241 245 249); }
.seg-btn {
  flex: 0 0 auto; padding: 3px 9px; border: 0; border-radius: 7px; background: transparent;
  font-size: 0.6875rem; font-weight: 500; line-height: 1.5; white-space: nowrap;
  color: rgb(71 85 105); cursor: pointer; transition: background-color 0.12s ease, color 0.12s ease;
}
.seg-btn:hover { color: rgb(15 23 42); }
.seg-btn.is-active { background: #ffffff; color: rgb(23 73 191); font-weight: 700; box-shadow: 0 1px 2px rgb(15 23 42 / 0.08); }
.seg-btn:focus-visible { outline: 2px solid rgb(89 158 255); outline-offset: 1px; }
</style>
