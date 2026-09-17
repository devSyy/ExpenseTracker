<script setup lang="ts">
// 고정비 vs 변동비 구성.
// 집계는 utils/aggregate.summarizeFixedVariable()가 그대로 담당한다(계산 변경 없음).
//
// 조각이 두 개뿐인 도넛은 "그래서 몇 퍼센트인가"가 바로 읽히지 않는다.
// 가운데에 고정비 비율을 큰 숫자로 얹어, 도넛은 비율의 모양만 담당하게 한다.
import { computed } from 'vue'
import { Doughnut } from 'vue-chartjs'
import { useExpenses } from '~/composables/useExpenses'
import { summarizeFixedVariable } from '~/utils/aggregate'
import { formatKRW, formatPercent } from '~/utils/format'
import {
  FIXED_COLOR,
  VARIABLE_COLOR,
  baseOptions,
  donutDataset,
  shareTooltip,
  type LegendItem
} from '~/utils/chartTheme'

const { filtered } = useExpenses()
const summary = computed(() => summarizeFixedVariable(filtered.value))

const chartData = computed(() => ({
  labels: ['고정비', '변동비'],
  datasets: [
    {
      ...donutDataset([FIXED_COLOR, VARIABLE_COLOR]),
      data: [summary.value.fixed, summary.value.variable]
    }
  ]
}))

const chartOptions = computed(() => {
  const base = baseOptions()
  return {
    ...base,
    // 가운데 숫자가 들어갈 자리를 확보한다
    cutout: '68%',
    plugins: { ...base.plugins, tooltip: shareTooltip() }
  }
})

const legendItems = computed<LegendItem[]>(() => [
  {
    label: '고정비',
    color: FIXED_COLOR,
    value: formatKRW(summary.value.fixed),
    hint: formatPercent(summary.value.fixedShare * 100)
  },
  {
    label: '변동비',
    color: VARIABLE_COLOR,
    value: formatKRW(summary.value.variable),
    hint: formatPercent(summary.value.variableShare * 100)
  }
])
</script>

<template>
  <ChartsCard
    title="고정비 vs 변동비"
    subtitle="고정비 비중이 높을수록 지출 구조가 경직적입니다"
    :empty="summary.total <= 0"
    body-class="h-chart-sm xl:h-chart-md"
  >
    <div class="relative h-full" role="img" :aria-label="`고정비 ${formatPercent(summary.fixedShare * 100)}, 변동비 ${formatPercent(summary.variableShare * 100)}`">
      <Doughnut :data="chartData" :options="chartOptions" />
      <!--
        가운데 라벨: 캔버스 플러그인 대신 DOM 오버레이.
        글자가 선명하고, 화면 폭에 따라 크기가 따라오며, 툴팁을 가리지 않는다(pointer-events 없음).
      -->
      <div class="donut-center">
        <div class="donut-center-label">고정비 비중</div>
        <div class="donut-center-value">{{ formatPercent(summary.fixedShare * 100) }}</div>
        <div class="donut-center-sub">총 {{ formatKRW(summary.total) }}</div>
      </div>
    </div>

    <template #footer>
      <ChartsLegend :items="legendItems" layout="list" />
    </template>
  </ChartsCard>
</template>

<style scoped>
.donut-center {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  text-align: center;
  pointer-events: none;   /* 아래 캔버스의 hover/툴팁을 막지 않는다 */
}
.donut-center-label {
  font-size: 0.6875rem;
  font-weight: 500;
  color: rgb(148 163 184);        /* slate-400 */
  line-height: 1.2;
}
.donut-center-value {
  /* 큰 숫자는 비례 숫자(기본값)가 더 정돈되어 보인다 — tabular-nums는 표에서만 */
  font-size: clamp(1.5rem, 1.1rem + 1vw, 2.125rem);
  font-weight: 700;
  color: rgb(15 23 42);          /* slate-900 */
  line-height: 1.1;
  margin-top: 0.125rem;
}
.donut-center-sub {
  font-size: 0.6875rem;
  color: rgb(100 116 139);        /* slate-500 */
  font-variant-numeric: tabular-nums;
  margin-top: 0.1875rem;
}
</style>
