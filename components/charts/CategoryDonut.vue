<script setup lang="ts">
// 카테고리별 지출 구성.
// 집계는 utils/aggregate.bucketByCategory()가 그대로 담당한다(계산 변경 없음).
// 표시 범위(상위 8개 + 나머지)도 기존과 동일하다.
//
// 조각이 많은 도넛은 색만으로 항목을 찾기 어렵다. 그래서 옆에 이름·금액·비중이 적힌
// HTML 범례를 두고, 도넛은 "구성의 모양"만 담당한다. 항목을 클릭하면 접을 수 있다.
import { computed, ref, watch } from 'vue'
import { Doughnut } from 'vue-chartjs'
import { useExpenses } from '~/composables/useExpenses'
import { useTaxonomies } from '~/composables/useTaxonomies'
import { bucketByCategory } from '~/utils/aggregate'
import { formatKRW, formatPercent } from '~/utils/format'
import {
  OTHERS_LABEL,
  baseOptions,
  categoryColors,
  donutDataset,
  shareTooltip,
  type LegendItem
} from '~/utils/chartTheme'

/** 도넛에 개별 조각으로 보여줄 카테고리 수 (기존과 동일) */
const TOP_N = 8

const { filtered } = useExpenses()
const { categoryNames } = useTaxonomies()
const rows = computed(() => bucketByCategory(filtered.value))

/** 라벨 · 값 · '나머지' 위치를 한 번만 계산해 차트와 범례가 같은 값을 쓰게 한다 */
const series = computed(() => {
  const top = rows.value.slice(0, TOP_N)
  const others = rows.value.slice(TOP_N)
  const labels = top.map((r) => r.category)
  const values = top.map((r) => r.total)
  let othersIndex = -1
  if (others.length > 0) {
    othersIndex = labels.length
    labels.push(OTHERS_LABEL)
    values.push(others.reduce((s, r) => s + r.total, 0))
  }
  // 색은 순위가 아니라 카테고리를 따라간다 — 설정 화면의 카테고리 순서가 기준이다.
  // 덕분에 기간 필터를 바꿔 순위가 흔들려도 '식비'는 계속 같은 색이다.
  const colors = categoryColors(labels, {
    order: categoryNames.value,
    othersIndex: othersIndex >= 0 ? othersIndex : undefined
  })
  const total = values.reduce((s, v) => s + v, 0)
  return { labels, values, colors, total, othersCount: others.length }
})

const hidden = ref<Set<number>>(new Set())
const chartRef = ref<any>(null)

function toggleSlice(i: number) {
  const chart = chartRef.value?.chart
  if (!chart) return
  chart.toggleDataVisibility(i)
  chart.update()
  const next = new Set(hidden.value)
  next.has(i) ? next.delete(i) : next.add(i)
  hidden.value = next
}

// 라벨 목록이 바뀌면(필터 변경 등) 숨김 상태는 의미가 없으므로 비운다
watch(() => series.value.labels.join('|'), () => {
  if (hidden.value.size > 0) hidden.value = new Set()
})

const chartData = computed(() => ({
  labels: series.value.labels,
  datasets: [{ ...donutDataset(series.value.colors), data: series.value.values }]
}))

const chartOptions = computed(() => {
  const base = baseOptions()
  return {
    ...base,
    cutout: '66%',
    plugins: { ...base.plugins, tooltip: shareTooltip() }
  }
})

const legendItems = computed<LegendItem[]>(() =>
  series.value.labels.map((label, i) => ({
    label,
    color: series.value.colors[i],
    value: formatKRW(series.value.values[i]),
    hint: formatPercent(
      series.value.total > 0 ? (series.value.values[i] / series.value.total) * 100 : 0
    ),
    hidden: hidden.value.has(i)
  }))
)

const subtitle = computed(() =>
  series.value.othersCount > 0
    ? `상위 ${TOP_N}개 카테고리 + 나머지 ${series.value.othersCount}개`
    : `카테고리 ${series.value.labels.length}개`
)
</script>

<template>
  <ChartsCard
    title="카테고리별 지출"
    :subtitle="subtitle"
    :empty="rows.length === 0"
    body-class="h-auto"
  >
    <!--
      도넛 위 / 범례 아래.
      이 카드는 대시보드의 좁은 컬럼(1/3~1/4)에 놓이므로 좌우 분할보다 세로 적층이 안전하다.
      범례는 항목이 많으면 자기만 스크롤되므로, 카테고리 수에 따라 카드 높이가 들쭉날쭉하지 않다.
    -->
    <div class="donut-layout">
      <div class="donut-plot" role="img" aria-label="카테고리별 지출 구성 도넛 차트">
        <Doughnut ref="chartRef" :data="chartData" :options="chartOptions" />
        <div class="donut-center">
          <div class="donut-center-label">총 지출</div>
          <div class="donut-center-value">{{ formatKRW(series.total) }}</div>
        </div>
      </div>
      <div class="donut-legend">
        <ChartsLegend :items="legendItems" layout="list" toggleable @toggle="toggleSlice" />
      </div>
    </div>
  </ChartsCard>
</template>

<style scoped>
.donut-layout {
  display: grid;
  gap: clamp(0.75rem, 0.5rem + 0.6vw, 1.25rem);
  grid-template-columns: 1fr;
  align-items: center;
}
.donut-plot {
  position: relative;
  width: 100%;
  height: clamp(200px, 26vh, 260px);
  margin-inline: auto;
  max-width: 320px;
}
.donut-legend {
  min-width: 0;
  /* 항목이 많아도 카드가 끝없이 길어지지 않게 — 넘치면 이 목록만 스크롤 */
  max-height: clamp(170px, 24vh, 260px);
  overflow-y: auto;
  padding-right: 2px;
}

.donut-center {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  text-align: center;
  pointer-events: none;
}
.donut-center-label {
  font-size: 0.6875rem;
  font-weight: 500;
  color: rgb(148 163 184);
  line-height: 1.2;
}
.donut-center-value {
  font-size: clamp(0.9375rem, 0.8rem + 0.5vw, 1.25rem);
  font-weight: 700;
  color: rgb(15 23 42);
  line-height: 1.15;
  margin-top: 0.125rem;
}
</style>
