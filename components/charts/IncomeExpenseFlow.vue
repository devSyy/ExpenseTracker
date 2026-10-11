<script setup lang="ts">
// 수입/지출 흐름 Sankey 다이어그램.
// 좌측: 수입 카테고리들 → 중앙(총수입/총지출) → 우측: 지출 카테고리들.
// 데이터 소스: useExpenses().filteredAll — FiltersBar의 전역 필터(연도·월·카테고리·
// 결제수단·구분·검색)와 활성 가족 멤버 합산이 반영된 거래. 수입/지출은 카테고리 type 기준.
// 월 지정에 따라 이 Sankey도 자동으로 재계산되므로 자체 월 selector는 두지 않는다.
import { computed, ref, onMounted, onBeforeUnmount, watch, shallowRef } from 'vue'
import type { ECharts } from 'echarts/core'
import { useExpenses } from '~/composables/useExpenses'
import { useFlowSummary } from '~/composables/useFlowSummary'
import { useTaxonomies } from '~/composables/useTaxonomies'

const { filteredAll, filters, expenseTotal } = useExpenses()
const { categories } = useTaxonomies()
// 수입·지출·저축 집계는 순수지 Hero / 수입은 어디로 갔나 / 저축 비율과 같은 값을 쓰도록 공통 요약에서 가져온다
const flow = useFlowSummary()

// 카테고리별 집계
// detail: '기타'로 합쳐진 원래 카테고리들 (지출 구성의 기타에 마우스를 올리면 보여준다)
interface Group { category: string; amount: number; share: number; detail?: Group[] }

// 집계 규칙(음수 = 지출, 이체·환불 상계 제외, 저축 분리, 지출 제외 플래그 존중)은 useFlowSummary 참고.
const incomeGroups = computed<Group[]>(() => flow.incomeGroups.value)
// 저축 카테고리 — 지출과 별개로 총수입에서 갈라져 나가는 흐름
const savingsGroups = computed<Group[]>(() => flow.savingsGroups.value)

// 지출 카테고리가 너무 많으면 우측 라벨이 겹치므로, 상위 MAX_EXPENSE_SLOTS-1개만 개별 플로우로
// 두고 나머지는 '기타' 하나로 합산한다. (카테고리명·금액은 모두 거래 데이터에서 동적으로 계산)
// 이미 '기타' 카테고리가 있으면 그 금액도 같은 '기타'로 합쳐지고, 항상 맨 아래에 놓인다.
const MAX_EXPENSE_SLOTS = 8
const OTHER_LABEL = '기타'

const expenseGroups = computed<Group[]>(() => {
  const all: Group[] = flow.expenseGroups.value
  if (all.length <= MAX_EXPENSE_SLOTS) return all
  const named = all.filter((g) => g.category !== OTHER_LABEL)
  const head = named.slice(0, MAX_EXPENSE_SLOTS - 1)
  const otherAmount = all.reduce((s, g) => s + g.amount, 0) - head.reduce((s, g) => s + g.amount, 0)
  const total = all.reduce((s, g) => s + g.amount, 0) || 1
  const merged = all.filter((g) => !head.includes(g)).map((g) => ({ ...g, share: g.amount / total }))
  return [...head, { category: OTHER_LABEL, amount: otherAmount, share: otherAmount / total, detail: merged }]
    .map((g) => ({ ...g, share: g.amount / total }))
})

// 전역 필터 상태를 사람이 읽을 수 있는 기간 라벨로 변환
const periodLabel = computed<string>(() => {
  const y = filters.year, m = filters.month
  if (y === 'all' && m === 'all') return '전체 기간'
  if (y !== 'all' && m === 'all') return `${y}년`
  if (y === 'all' && m !== 'all') return `${m}월 (매년)`
  return `${y}년 ${m}월`
})
const periodHasData = computed(() => filteredAll.value.length > 0)

const totalIncome = computed(() => incomeGroups.value.reduce((s, g) => s + g.amount, 0))
const totalExpense = computed(() => expenseGroups.value.reduce((s, g) => s + g.amount, 0))
const totalSavings = computed(() => savingsGroups.value.reduce((s, g) => s + g.amount, 0))
const net = computed(() => totalIncome.value - totalExpense.value)
// 수입으로 채우지 못한 지출·저축 — 샌키에서 회색 띠(수입 초과 지출)로 합류시킨다
const deficit = computed(() => (totalIncome.value > 0 ? flow.allocation.value.shortfallOut + flow.allocation.value.shortfallSav : 0))
// 남은 금액 = 수입 − 지출 − 저축 (수입 안에서 실제로 남은 몫)
const remainFromIn = computed(() => flow.allocation.value.remainFromIn)
// 흐름도 총지출은 저축을 지출에서 분리해 집계하므로 KPI 총지출(expenseTotal)과 다를 수 있다
const kpiGap = computed(() => Math.abs(expenseTotal.value - totalExpense.value))
// 저축률 = 총저축 ÷ 총수입 (useExpenses.savingsRate와 같은 식 — 흐름도 집계 기준)
const savingsPct = computed(() => (totalIncome.value > 0 ? (totalSavings.value / totalIncome.value) * 100 : null))

// ── 구성 막대 (수입·지출·저축 구성 패널) ──
interface Bar { name: string; amount: number; share: number; pct: number; detail?: Group[] }
function toBars(groups: Group[]): Bar[] {
  const max = Math.max(...groups.map((g) => g.amount), 1)
  return groups.map((g) => ({ name: g.category, amount: g.amount, share: g.share, pct: (g.amount / max) * 100, detail: g.detail }))
}
// 저축 구성은 거래가 없는 달에도 저축 카테고리(저축·정기적금·비상금·여행비·경조사비 등)를 전부 보여준다.
// 설정에서 유형이 '저축'인 (숨기지 않은) 카테고리는 지출제외 여부와 무관하게 금액이 0이어도 목록에 올린다.
const savingsBars = computed<Bar[]>(() => {
  const have = new Map(savingsGroups.value.map((g) => [g.category, g]))
  const zero: Group[] = categories.value
    .filter((c) => c.type === '저축' && !c.hidden && !have.has(c.name))
    .map((c) => ({ category: c.name, amount: 0, share: 0 }))
  return toBars([...savingsGroups.value, ...zero])
})
const panels = computed(() => [
  { key: 'in', title: '수입 구성', total: totalIncome.value, bars: toBars(incomeGroups.value),
    box: 'bg-blue-50/50 ring-blue-100', head: 'text-blue-900', fill: 'bg-blue-500', track: 'bg-blue-100/70' },
  { key: 'out', title: '지출 구성', total: totalExpense.value, bars: toBars(expenseGroups.value),
    box: 'bg-rose-50/50 ring-rose-100', head: 'text-rose-900', fill: 'bg-rose-500', track: 'bg-rose-100/70' },
  { key: 'sav', title: '저축 구성', total: totalSavings.value, bars: savingsBars.value,
    box: 'bg-teal-50/50 ring-teal-100', head: 'text-teal-900', fill: 'bg-teal-600', track: 'bg-teal-100/70' }
].filter((p) => p.bars.length > 0))

// ── ECharts Sankey ──
// 노드: [수입 카테고리들] → 총수입 → 총지출 → [지출 카테고리들]
// 노드 이름은 ECharts에서 유일해야 하므로 'in:'/'out:' 접두사로 구분하고(같은 이름의 카테고리가
// 양쪽에 있을 수 있다), 표시는 라벨 formatter에서 접두사를 떼어 쓴다.
// 라벨은 1줄(이름 · 금액 · 비율) ≈ 20px. 노드 중심 간 거리는 항상 nodeGap 이상이므로 gap ≥ 라벨 높이면 겹치지 않는다.
const LABEL_H = 22
const NODE_GAP = LABEL_H + 6
const TOTAL_IN = '__total_in__'
const TOTAL_OUT = '__total_out__'
const TOTAL_SAV = '__total_sav__'
const DEFICIT = '__deficit__'
const REMAIN = '__remain__'

function shade(hue: number, sat: number, base: number, step: number, i: number, n: number): string {
  const t = n <= 1 ? 0 : i / (n - 1)
  return `hsl(${hue}, ${sat}%, ${base + t * step}%)`
}

interface NodeMeta { label: string; amount: number; share: number | null; kind: 'in' | 'out' | 'sav' | 'total' | 'def' | 'rem' }
const meta = computed<Record<string, NodeMeta>>(() => {
  const m: Record<string, NodeMeta> = {}
  incomeGroups.value.forEach((g) => { m['in:' + g.category] = { label: g.category, amount: g.amount, share: g.share, kind: 'in' } })
  expenseGroups.value.forEach((g) => { m['out:' + g.category] = { label: g.category, amount: g.amount, share: g.share, kind: 'out' } })
  savingsGroups.value.forEach((g) => { m['sav:' + g.category] = { label: g.category, amount: g.amount, share: g.share, kind: 'sav' } })
  m[TOTAL_SAV] = { label: '총저축', amount: totalSavings.value, share: null, kind: 'total' }
  m[REMAIN] = { label: '남은 금액', amount: remainFromIn.value, share: totalIncome.value > 0 ? remainFromIn.value / totalIncome.value : null, kind: 'rem' }
  m[DEFICIT] = { label: '수입 초과 지출', amount: deficit.value, share: null, kind: 'def' }
  m[TOTAL_IN] = { label: '총수입', amount: totalIncome.value, share: null, kind: 'total' }
  m[TOTAL_OUT] = { label: '총지출', amount: totalExpense.value, share: null, kind: 'total' }
  return m
})

const sankeyData = computed(() => {
  const inG = incomeGroups.value
  const outG = expenseGroups.value
  const nodes: Record<string, unknown>[] = []
  const links: Record<string, unknown>[] = []

  inG.forEach((g, i) => {
    const color = shade(222, 85, 55, 15, i, inG.length)
    nodes.push({ name: 'in:' + g.category, depth: 0, itemStyle: { color } })
    links.push({ source: 'in:' + g.category, target: TOTAL_IN, value: g.amount, lineStyle: { color, opacity: 0.45 } })
  })
  nodes.push({ name: TOTAL_IN, depth: 1, itemStyle: { color: '#3b82f6' } })
  nodes.push({ name: TOTAL_OUT, depth: 2, itemStyle: { color: '#ef4444' } })
  // 총수입 → 지출 / 저축 / 남은 금액. 지출 → 저축 순으로 수입을 채우고, 남은 몫이 '남은 금액'이다.
  // 수입이 모자라 못 채운 지출·저축은 회색 '수입 초과 지출' 노드가 대신 이어 주므로
  // 모든 노드에서 들어오는 양 = 나가는 양이 유지된다.
  const al = flow.allocation.value
  const hasIncome = totalIncome.value > 0
  if (hasIncome && al.outFromIn > 0) {
    links.push({ source: TOTAL_IN, target: TOTAL_OUT, value: al.outFromIn, lineStyle: { color: '#fb7185', opacity: 0.35 } })
  }
  if (hasIncome && totalSavings.value > 0) {
    nodes.push({ name: TOTAL_SAV, depth: 2, itemStyle: { color: '#0f766e' } })
    if (al.savFromIn > 0) links.push({ source: TOTAL_IN, target: TOTAL_SAV, value: al.savFromIn, lineStyle: { color: '#5eead4', opacity: 0.6 } })
  }
  if (hasIncome && al.remainFromIn > 0) {
    nodes.push({ name: REMAIN, depth: 2, itemStyle: { color: '#94a3b8' } })
    links.push({ source: TOTAL_IN, target: REMAIN, value: al.remainFromIn, lineStyle: { color: '#94a3b8', opacity: 0.35 } })
  }
  if (deficit.value > 0) {
    nodes.push({ name: DEFICIT, depth: 1, itemStyle: { color: '#94a3b8' }, label: { position: 'bottom', distance: 6 } })
    if (al.shortfallOut > 0) links.push({ source: DEFICIT, target: TOTAL_OUT, value: al.shortfallOut, lineStyle: { color: '#94a3b8', opacity: 0.4 } })
    if (al.shortfallSav > 0) links.push({ source: DEFICIT, target: TOTAL_SAV, value: al.shortfallSav, lineStyle: { color: '#94a3b8', opacity: 0.4 } })
  }
  outG.forEach((g, i) => {
    const color = shade(0, 78, 60, 15, i, outG.length)
    nodes.push({ name: 'out:' + g.category, depth: 3, itemStyle: { color } })
    links.push({ source: TOTAL_OUT, target: 'out:' + g.category, value: g.amount, lineStyle: { color, opacity: 0.5 } })
  })
  // 저축 카테고리 (총저축 → 카테고리). 총수입이 없으면 총저축 노드를 직접 만든다.
  const sG = savingsGroups.value
  if (sG.length > 0 && !(totalIncome.value > 0)) nodes.push({ name: TOTAL_SAV, depth: 2, itemStyle: { color: '#0f766e' } })
  sG.forEach((g, i) => {
    const color = shade(174, 70, 32, 18, i, sG.length)
    nodes.push({ name: 'sav:' + g.category, depth: 3, itemStyle: { color } })
    links.push({ source: TOTAL_SAV, target: 'sav:' + g.category, value: g.amount, lineStyle: { color, opacity: 0.5 } })
  })
  return { nodes, links }
})

const chartEl = ref<HTMLDivElement | null>(null)
const chart = shallowRef<ECharts | null>(null)
let ro: ResizeObserver | null = null

function buildOption() {
  const m = meta.value
  const labelOf = (name: string) => m[name]?.label ?? name
  return {
    animation: true,
    tooltip: {
      trigger: 'item',
      confine: true,
      formatter: (p: { dataType: string; name: string; value: number; data: { source?: string; target?: string } }) => {
        if (p.dataType === 'edge') {
          return `${labelOf(p.data.source ?? '')} → ${labelOf(p.data.target ?? '')}<br/><b>${fmtKRW(p.value)}</b>`
        }
        const n = m[p.name]
        if (!n) return ''
        return `${n.label}<br/><b>${fmtKRW(n.amount)}</b>` +
          (n.share !== null ? ` (${n.kind === 'in' || n.kind === 'rem' ? '수입' : n.kind === 'sav' ? '총저축' : '총지출'}의 ${fmtPct(n.share)})` : '')
      }
    },
    series: [{
      type: 'sankey',
      left: '20%', right: '20%', top: 32, bottom: 12,
      nodeWidth: 14,
      nodeGap: NODE_GAP, // 라벨 높이(LABEL_H) 이상이어야 이웃 노드 라벨이 겹치지 않는다
      nodeAlign: 'justify',
      draggable: false,
      layoutIterations: 0,   // 입력(금액 내림차순) 순서를 유지
      emphasis: { focus: 'adjacency' },
      lineStyle: { curveness: 0.5 },
      label: {
        fontSize: 13,
        color: '#334155',
        formatter: (p: { name: string }) => {
          const n = m[p.name]
          if (!n) return ''
          if (n.kind === 'def') return `{c|${n.label}}  {ad|${fmtKRW(n.amount)}}`
          if (n.kind === 'total') return `{t|${n.label}} {a|${fmtKRW(n.amount)}}`
          const pct = n.share !== null ? `  {p|${fmtPct(n.share)}}` : ''
          // 1줄: [이름 금액 비율] — 높이를 낮춰 작은 노드끼리도 겹치지 않게 하면서 차트 전체 높이를 줄인다
          // (비율의 기준은 툴팁에 '수입의/총지출의/총저축의 N%'로 표시된다)
          return `{c|${n.label}}  {${n.kind === 'in' ? 'ai' : n.kind === 'sav' ? 'as' : n.kind === 'rem' ? 'ad' : 'ao'}|${fmtKRW(n.amount)}}${pct}`
        },
        rich: {
          c: { fontSize: 14, fontWeight: 600, color: '#334155', lineHeight: 20 },
          ai: { fontSize: 13, fontWeight: 700, color: '#2563eb', lineHeight: 18 },
          as: { fontSize: 13, fontWeight: 700, color: '#0f766e', lineHeight: 18 },
          ad: { fontSize: 13, fontWeight: 700, color: '#64748b', lineHeight: 18 },
          ao: { fontSize: 13, fontWeight: 700, color: '#dc2626', lineHeight: 18 },
          p: { fontSize: 11, color: '#94a3b8', lineHeight: 16 },
          t: { fontSize: 13, fontWeight: 700, color: '#334155', lineHeight: 18 },
          a: { fontSize: 14, fontWeight: 700, color: '#1e293b', lineHeight: 18 }
        }
      },
      levels: [
        { depth: 0, label: { position: 'left' } },
        { depth: 1, label: { position: 'top', distance: 6 } },
        { depth: 2, label: { position: 'top', distance: 6 } },
        { depth: 3, label: { position: 'right' } }
      ],
      data: sankeyData.value.nodes,
      links: sankeyData.value.links
    }]
  }
}

const hasChart = computed(() => periodHasData.value && (incomeGroups.value.length > 0 || expenseGroups.value.length > 0 || savingsGroups.value.length > 0))
// 노드 수에 맞춰 높이를 키워 라벨이 겹치지 않게 한다 (좁은 화면에서는 가로 스크롤 없이 세로로 늘어난다)
// 상·하한을 두어 데이터가 많아도 화면을 과하게 차지하지 않는다.
const chartHeight = computed(() => {
  const rows = Math.max(incomeGroups.value.length, expenseGroups.value.length + savingsGroups.value.length)
  return Math.min(520, Math.max(300, rows * NODE_GAP + 150))
})

async function render() {
  if (!chartEl.value || !hasChart.value) return
  if (!chart.value) {
    const [echarts, { SankeyChart }, { TooltipComponent }, { CanvasRenderer }] = await Promise.all([
      import('echarts/core'),
      import('echarts/charts'),
      import('echarts/components'),
      import('echarts/renderers')
    ])
    echarts.use([SankeyChart, TooltipComponent, CanvasRenderer])
    if (!chartEl.value) return
    chart.value = echarts.init(chartEl.value)
    ro = new ResizeObserver(() => chart.value?.resize())
    ro.observe(chartEl.value)
  }
  chart.value.setOption(buildOption(), true)
  chart.value.resize()
}

onMounted(render)
watch([sankeyData, meta, chartHeight, hasChart], async () => {
  // v-if 로 DOM이 새로 만들어지면 이전 인스턴스는 죽은 요소를 보고 있으므로 폐기 후 재생성
  if (chart.value && chart.value.getDom() !== chartEl.value) {
    ro?.disconnect(); chart.value.dispose(); chart.value = null
  }
  await nextTickRender()
}, { flush: 'post' })
function nextTickRender() { return render() }
onBeforeUnmount(() => { ro?.disconnect(); chart.value?.dispose(); chart.value = null })

// ── 포맷 ──
// ₩1,000,000 형식
function fmtKRW(n: number): string {
  return '₩' + Math.round(n).toLocaleString('ko-KR')
}
function fmtPct(n: number): string {
  return (n * 100).toFixed(1) + '%'
}
</script>


<template>
  <section class="card overflow-hidden">
    <header class="flex items-end justify-between flex-wrap gap-2 mb-4">
      <h3 class="text-lg font-bold text-slate-900">
        <span class="mr-2">{{ periodLabel }}</span>
        수입지출 흐름
      </h3>
      <div class="text-xs text-slate-500">
        단위: KRW · 저축은 지출과 분리해 집계
        <template v-if="kpiGap > 0">
          (KPI 총지출 {{ fmtKRW(expenseTotal) }}과 {{ fmtKRW(kpiGap) }} 차이)
        </template>
      </div>
    </header>

    <!-- 요약 4타일: 총수입 · 총지출 · 총저축 · 순수지 -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div class="rounded-xl bg-blue-50 px-4 py-3">
        <div class="text-xs text-blue-700">총수입</div>
        <div class="text-xl font-bold text-blue-900 tabular-nums mt-1">{{ fmtKRW(totalIncome) }}</div>
      </div>
      <div class="rounded-xl bg-rose-50 px-4 py-3">
        <div class="text-xs text-rose-700">총지출</div>
        <div class="text-xl font-bold text-rose-900 tabular-nums mt-1">{{ fmtKRW(totalExpense) }}</div>
      </div>
      <div class="rounded-xl bg-teal-50 px-4 py-3">
        <div class="text-xs text-teal-700">
          총저축
          <span v-if="savingsPct !== null" class="text-teal-600/80">· 수입의 {{ savingsPct.toFixed(1) }}%</span>
        </div>
        <div class="text-xl font-bold text-teal-900 tabular-nums mt-1">{{ fmtKRW(totalSavings) }}</div>
      </div>
      <div class="rounded-xl bg-slate-900 px-4 py-3">
        <div class="text-xs text-slate-300">순수지 (Net Balance)</div>
        <div :class="['text-xl font-bold tabular-nums mt-1', net >= 0 ? 'text-emerald-300' : 'text-orange-300']">
          {{ net >= 0 ? '+' : '−' }}{{ fmtKRW(Math.abs(net)) }}
        </div>
      </div>
    </div>

    <!-- Sankey -->
    <div class="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
      <div class="flex items-center justify-between flex-wrap gap-2 mb-2">
        <h4 class="text-sm font-bold text-slate-800">흐름 그래프</h4>
        <div class="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
          <span class="inline-flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm bg-blue-500"></span> 수입</span>
          <span class="inline-flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm bg-rose-500"></span> 지출</span>
          <span class="inline-flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm bg-slate-400"></span> 남은 금액 · 수입 초과분</span>
          <span class="inline-flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm bg-teal-600"></span> 저축</span>
        </div>
      </div>

      <div v-if="!periodHasData"
           class="h-64 grid place-items-center text-center text-sm text-slate-400">
        <div>
          선택된 기간({{ periodLabel }})에 해당하는 거래가 없습니다.
          <div class="mt-1 text-[11px]">상단 필터바에서 연도/월을 바꾸거나 "전체"로 돌려 보세요.</div>
        </div>
      </div>
      <div v-else-if="!hasChart"
           class="h-64 grid place-items-center text-center text-sm text-slate-400">
        <div>
          이 기간의 수입/지출 분류 데이터가 없습니다.
          <div class="mt-1 text-[11px]">카테고리의 '구분(수입/지출)'을 설정 페이지에서 지정하세요.</div>
        </div>
      </div>
      <div v-else ref="chartEl" class="w-full" :style="{ height: chartHeight + 'px' }"></div>

      <p class="mt-2 text-[11px] text-slate-500">
        띠 두께는 금액에 비례합니다.
        회색은 수입 중 남은 금액입니다.
        <template v-if="deficit > 0">수입으로 채우지 못한 지출·저축({{ fmtKRW(deficit) }})은 '수입 초과 지출'로 이어집니다.</template>
        위 필터바에서 연도/월을 지정하면 즉시 반영됩니다.
      </p>
    </div>

    <!-- 구성 패널: 수입 · 지출 · 저축 -->
    <div v-if="hasChart && panels.length" class="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
      <div v-for="p in panels" :key="p.key" :class="['rounded-xl ring-1 p-4', p.box]">
        <h4 :class="['text-sm font-bold mb-3', p.head]">{{ p.title }} · {{ fmtKRW(p.total) }}</h4>
        <div class="space-y-3">
          <div v-for="b in p.bars" :key="b.name"
               class="group relative grid grid-cols-[5.5rem_1fr_auto] items-center gap-2.5"
               :tabindex="b.detail && b.detail.length ? 0 : undefined">
            <div class="min-w-0">
              <div class="text-sm font-medium text-slate-800 truncate">{{ b.name }}</div>
              <div class="text-[11px] text-slate-500">{{ fmtPct(b.share) }}</div>
            </div>
            <div :class="['h-4 rounded-md', p.track]">
              <div
                :class="['h-4 rounded-md min-w-[4px]', p.fill, p.key === 'out' && b.name === OTHER_LABEL ? 'opacity-50' : '']"
                :style="{ width: b.pct + '%' }"
              ></div>
            </div>
            <div class="text-sm font-bold text-slate-800 tabular-nums text-right">{{ fmtKRW(b.amount) }}</div>
            <!-- 기타 상세 — 합쳐진 카테고리와 금액 (위쪽으로 띄워 카드의 overflow에 잘리지 않게 한다) -->
            <div v-if="b.detail && b.detail.length"
                 class="hidden group-hover:block group-focus:block absolute right-0 bottom-full z-30 pb-1">
              <div class="w-64 max-h-64 overflow-y-auto rounded-lg bg-white shadow-lg ring-1 ring-slate-200 p-3">
                <div class="text-xs font-bold text-slate-700 mb-2">{{ b.name }} 상세 · {{ b.detail.length }}개 카테고리</div>
                <ul class="space-y-1">
                  <li v-for="d in b.detail" :key="d.category" class="flex items-baseline justify-between gap-3 text-xs">
                    <span class="truncate text-slate-600">{{ d.category }} <span class="text-slate-400">{{ fmtPct(d.share) }}</span></span>
                    <span class="font-semibold text-slate-800 tabular-nums">{{ fmtKRW(d.amount) }}</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
