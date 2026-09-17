<script setup lang="ts">
// 월별 × 카테고리 누적 막대.
// 집계는 utils/aggregate.monthlyCategoryStack()가 그대로 담당한다(계산 변경 없음).
// 표시 범위(상위 6개 + 나머지)도 기존과 동일하다.
import { computed, ref, watch } from 'vue'
import { Bar } from 'vue-chartjs'
import { useExpenses } from '~/composables/useExpenses'
import { useTaxonomies } from '~/composables/useTaxonomies'
import { monthlyCategoryStack } from '~/utils/aggregate'
import { formatKRW } from '~/utils/format'
import {
  baseOptions,
  barScales,
  categoryColors,
  currencyTooltipY,
  stackTotalFooter,
  stackedBarSegment,
  type LegendItem
} from '~/utils/chartTheme'

/** 개별 시리즈로 쌓을 카테고리 수 (기존과 동일) */
const TOP_N = 6

const { filtered } = useExpenses()
const { categoryNames } = useTaxonomies()
const stack = computed(() => monthlyCategoryStack(filtered.value, TOP_N))

/**
 * 색 배정. monthlyCategoryStack은 상위 N개를 넘길 때 마지막에 '나머지' 묶음을 덧붙이므로,
 * 항목 수가 TOP_N보다 많으면 마지막 인덱스가 그 묶음이다 → 중립 회색을 준다.
 */
const colors = computed(() =>
  categoryColors(stack.value.categories, {
    order: categoryNames.value,
    othersIndex: stack.value.categories.length > TOP_N ? stack.value.categories.length - 1 : undefined
  })
)

/** 카테고리별 합계 — 범례에 금액을 함께 적기 위해 */
const seriesTotals = computed(() => stack.value.data.map((row) => row.reduce((s, v) => s + v, 0)))
const grandTotal = computed(() => seriesTotals.value.reduce((s, v) => s + v, 0))

const hidden = ref<Set<number>>(new Set())
const chartRef = ref<any>(null)

function toggleSeries(i: number) {
  const chart = chartRef.value?.chart
  if (!chart) return
  const next = !chart.isDatasetVisible(i)
  chart.setDatasetVisibility(i, next)
  chart.update()
  const set = new Set(hidden.value)
  next ? set.delete(i) : set.add(i)
  hidden.value = set
}

// 카테고리 구성이 바뀌면 숨김 상태는 의미가 없으므로 비운다
watch(() => stack.value.categories.join('|'), () => {
  if (hidden.value.size > 0) hidden.value = new Set()
})

const chartData = computed(() => ({
  labels: stack.value.months,
  datasets: stack.value.categories.map((cat, i) => ({
    ...stackedBarSegment(colors.value[i], cat, 'cat'),
    data: stack.value.data[i]
  }))
}))

const chartOptions = computed(() => {
  const base = baseOptions()
  const tip = currencyTooltipY()
  return {
    ...base,
    // 한 달의 모든 카테고리를 한 번에 보여준다
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      ...base.plugins,
      tooltip: { ...tip, callbacks: { ...tip.callbacks, footer: stackTotalFooter() } }
    },
    scales: barScales({ stacked: true, categoryTicks: 12 })
  }
})

const legendItems = computed<LegendItem[]>(() =>
  stack.value.categories.map((cat, i) => ({
    label: cat,
    color: colors.value[i],
    value: formatKRW(seriesTotals.value[i]),
    hidden: hidden.value.has(i)
  }))
)
</script>

<template>
  <ChartsCard
    title="월별 × 카테고리 누적"
    :subtitle="`상위 ${TOP_N}개 카테고리 기준 월별 구성 · 범례를 클릭하면 접을 수 있습니다`"
    :metric="formatKRW(grandTotal)"
    metric-label="합계"
    :empty="stack.months.length === 0"
  >
    <template #legend>
      <ChartsLegend :items="legendItems" toggleable @toggle="toggleSeries" />
    </template>

    <div class="h-full" role="img" aria-label="월별 카테고리 누적 지출 차트">
      <Bar ref="chartRef" :data="chartData" :options="chartOptions" />
    </div>
  </ChartsCard>
</template>
