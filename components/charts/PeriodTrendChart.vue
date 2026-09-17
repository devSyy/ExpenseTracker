<script setup lang="ts">
// 기간별 지출 추이 — 고정비/변동비 누적 막대.
// 집계는 utils/aggregate.bucketByPeriod()가 그대로 담당한다(계산 변경 없음).
import { computed, ref } from 'vue'
import { Bar } from 'vue-chartjs'
import { useExpenses } from '~/composables/useExpenses'
import { bucketByPeriod } from '~/utils/aggregate'
import { formatKRW, formatPercent } from '~/utils/format'
import {
  FIXED_COLOR,
  VARIABLE_COLOR,
  baseOptions,
  barScales,
  currencyTooltipY,
  stackTotalFooter,
  stackedBarSegment,
  type LegendItem
} from '~/utils/chartTheme'
import type { PeriodKind } from '~/utils/types'

const kind = ref<PeriodKind>('monthly')
const labels: Record<PeriodKind, string> = {
  weekly: '주간',
  monthly: '월별',
  quarterly: '분기별',
  semiannual: '반기별',
  yearly: '연도별'
}
const periodOptions: PeriodKind[] = ['weekly', 'monthly', 'quarterly', 'semiannual', 'yearly']

const { filtered } = useExpenses()
const buckets = computed(() => bucketByPeriod(filtered.value, kind.value))

const totals = computed(() => {
  let fixed = 0
  let variable = 0
  for (const b of buckets.value) { fixed += b.fixed; variable += b.variable }
  return { fixed, variable, total: fixed + variable }
})

// 범례 — 이름 + 합계 + 비중. 클릭으로 시리즈를 접을 수 있다.
const hiddenSeries = ref<[boolean, boolean]>([false, false])
const legendItems = computed<LegendItem[]>(() => {
  const t = totals.value.total || 1
  return [
    {
      label: '고정비',
      color: FIXED_COLOR,
      value: formatKRW(totals.value.fixed),
      hint: formatPercent((totals.value.fixed / t) * 100),
      hidden: hiddenSeries.value[0]
    },
    {
      label: '변동비',
      color: VARIABLE_COLOR,
      value: formatKRW(totals.value.variable),
      hint: formatPercent((totals.value.variable / t) * 100),
      hidden: hiddenSeries.value[1]
    }
  ]
})

const chartRef = ref<any>(null)

function toggleSeries(i: number) {
  const chart = chartRef.value?.chart
  if (!chart) return
  const next = !chart.isDatasetVisible(i)
  chart.setDatasetVisibility(i, next)
  chart.update()
  const flags: [boolean, boolean] = [...hiddenSeries.value]
  flags[i] = !next
  hiddenSeries.value = flags
}

const chartData = computed(() => ({
  labels: buckets.value.map((b) => b.label),
  datasets: [
    { ...stackedBarSegment(FIXED_COLOR, '고정비'), data: buckets.value.map((b) => b.fixed) },
    { ...stackedBarSegment(VARIABLE_COLOR, '변동비'), data: buckets.value.map((b) => b.variable) }
  ]
}))

const chartOptions = computed(() => {
  const base = baseOptions()
  return {
    ...base,
    plugins: {
      ...base.plugins,
      tooltip: {
        ...currencyTooltipY(),
        callbacks: {
          ...currencyTooltipY().callbacks,
          // 누적 막대는 "이 기간 총 얼마"가 같이 보여야 읽힌다
          footer: stackTotalFooter()
        }
      }
    },
    // 한 막대의 두 세그먼트를 함께 보여주려면 index 모드가 맞다
    interaction: { mode: 'index' as const, intersect: false },
    scales: barScales({
      stacked: true,
      // 주간은 라벨이 많아 겹치므로 자동 건너뛰기 한도를 좁게 준다
      categoryTicks: kind.value === 'weekly' ? 8 : 12
    })
  }
})
</script>

<template>
  <ChartsCard
    :title="`${labels[kind]} 지출 추이`"
    subtitle="고정비와 변동비를 쌓아 기간별 지출 규모와 구성을 함께 봅니다"
    :empty="buckets.length === 0"
    empty-text="선택한 기간·필터에 해당하는 데이터가 없습니다."
  >
    <!-- 기간 선택: 세그먼트 컨트롤. 좁은 화면에서는 가로 스크롤되어 줄바꿈으로 깨지지 않는다 -->
    <template #actions>
      <div class="seg-scroll">
        <div class="seg" role="group" aria-label="집계 기간">
          <button
            v-for="k in periodOptions"
            :key="k"
            type="button"
            :class="['seg-btn', kind === k ? 'is-active' : '']"
            :aria-pressed="kind === k"
            @click="kind = k"
          >{{ labels[k] }}</button>
        </div>
      </div>
    </template>

    <!-- 합계는 별도 메트릭으로 두지 않는다 — 범례가 고정비/변동비 금액과 비중을 이미 담고 있고,
         기간 선택 버튼과 나란히 놓으면 헤더가 좁은 화면에서 붐빈다 -->
    <template #legend>
      <ChartsLegend :items="legendItems" toggleable @toggle="toggleSeries" />
    </template>

    <div class="h-full" role="img" :aria-label="`${labels[kind]} 고정비·변동비 누적 지출 차트`">
      <Bar ref="chartRef" :data="chartData" :options="chartOptions" />
    </div>
  </ChartsCard>
</template>

<style scoped>
/* 좁은 화면에서 버튼 5개가 줄바꿈으로 흩어지지 않도록 가로 스크롤 컨테이너에 담는다 */
.seg-scroll {
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}
.seg-scroll::-webkit-scrollbar { display: none; }

.seg {
  display: inline-flex;
  padding: 2px;
  gap: 2px;
  border-radius: 9px;
  background: rgb(241 245 249);       /* slate-100 */
}
.seg-btn {
  flex: 0 0 auto;
  padding: 3px 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  font-size: 0.6875rem;
  font-weight: 500;
  line-height: 1.5;
  white-space: nowrap;
  color: rgb(71 85 105);              /* slate-600 */
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}
.seg-btn:hover { color: rgb(15 23 42); }
.seg-btn.is-active {
  background: #ffffff;
  color: rgb(23 73 191);              /* brand-700 */
  font-weight: 700;
  box-shadow: 0 1px 2px rgb(15 23 42 / 0.08);
}
.seg-btn:focus-visible {
  outline: 2px solid rgb(89 158 255);
  outline-offset: 1px;
}
</style>
