<script setup lang="ts">
// 결제수단별 지출 — 가로 막대.
// 집계는 utils/aggregate.bucketByPayment()가 그대로 담당한다(계산 변경 없음).
//
// 결제수단은 순서에 의미가 없는 명목형 항목이고, 크기는 이미 막대 길이가 말한다.
// 그래서 막대마다 다른 색을 주지 않고 **한 가지 색**으로 통일했다.
// (막대마다 색을 바꾸면 길이가 이미 보여준 정보를 색으로 한 번 더 칠하는 셈이고,
//  결제수단이 늘어날수록 서로 구분되지 않는 색이 생긴다)
import { computed } from 'vue'
import { Bar } from 'vue-chartjs'
import { useExpenses } from '~/composables/useExpenses'
import { bucketByPayment } from '~/utils/aggregate'
import { formatKRW, formatPercent } from '~/utils/format'
import {
  BAR_RADIUS,
  BAR_THICKNESS,
  SINGLE_SERIES,
  barTipLabels,
  baseOptions,
  barScales,
  currencyTooltipX
} from '~/utils/chartTheme'

const { filtered } = useExpenses()
const rows = computed(() => bucketByPayment(filtered.value))
const total = computed(() => rows.value.reduce((s, r) => s + r.total, 0))

const chartData = computed(() => ({
  labels: rows.value.map((r) => r.method),
  datasets: [
    {
      label: '지출',
      data: rows.value.map((r) => r.total),
      backgroundColor: SINGLE_SERIES,
      hoverBackgroundColor: '#1749bf',   // brand-700 — hover 시 마크가 반응한다
      borderRadius: BAR_RADIUS,
      borderSkipped: 'start' as const,   // 기준선 쪽은 각지게
      maxBarThickness: BAR_THICKNESS
    }
  ]
}))

const chartOptions = computed(() => {
  const base = baseOptions()
  return {
    ...base,
    indexAxis: 'y' as const,
    plugins: {
      ...base.plugins,
      tooltip: currencyTooltipX(() => total.value)
    },
    // 막대 끝에 값을 적으므로 오른쪽에 글자 자리를 남긴다
    layout: { padding: { top: 4, right: 56, bottom: 0, left: 0 } },
    scales: barScales({ horizontal: true, valueTicks: 4 })
  }
})

/** 결제수단 수가 늘면 막대가 눌리지 않게 카드 높이를 함께 키운다 */
const bodyClass = computed(() =>
  rows.value.length > 7 ? 'h-chart-lg' : 'h-chart-md xl:h-chart-lg'
)

const topRow = computed(() => rows.value[0])
</script>

<template>
  <ChartsCard
    title="결제수단별 지출"
    :subtitle="rows.length > 0
      ? `결제수단 ${rows.length}개 · 많이 쓴 순서`
      : '결제수단별 지출 비중'"
    :metric="topRow ? `${topRow.method} ${formatPercent(topRow.share * 100)}` : undefined"
    :metric-label="topRow ? '최다 사용' : undefined"
    :empty="rows.length === 0"
    :body-class="bodyClass"
  >
    <!-- 단일 시리즈이므로 범례를 두지 않는다 — 제목이 이미 무엇을 그린 것인지 말한다 -->
    <div class="h-full" role="img" aria-label="결제수단별 지출 가로 막대 차트">
      <Bar :data="chartData" :options="chartOptions" :plugins="[barTipLabels]" />
    </div>
  </ChartsCard>
</template>
