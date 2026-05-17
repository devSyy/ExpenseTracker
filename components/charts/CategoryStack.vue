<script setup lang="ts">
import { computed } from 'vue'
import { Bar } from 'vue-chartjs'
import { useExpenses } from '~/composables/useExpenses'
import { monthlyCategoryStack } from '~/utils/aggregate'
import { formatKRW, formatKRWCompact } from '~/utils/format'
import { pickColors } from '~/utils/palette'

const { filtered } = useExpenses()
const stack = computed(() => monthlyCategoryStack(filtered.value, 6))

const chartData = computed(() => {
  const colors = pickColors(stack.value.categories.length)
  return {
    labels: stack.value.months,
    datasets: stack.value.categories.map((cat, i) => ({
      label: cat,
      data: stack.value.data[i],
      backgroundColor: colors[i],
      stack: 'cat',
      borderRadius: 3,
      maxBarThickness: 28
    }))
  }
})

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'bottom' as const, labels: { boxWidth: 12 } },
    tooltip: {
      callbacks: {
        label: (ctx: any) => `${ctx.dataset.label}: ${formatKRW(ctx.parsed.y)}`
      }
    }
  },
  scales: {
    x: { stacked: true, grid: { display: false } },
    y: {
      stacked: true,
      ticks: { callback: (v: number | string) => formatKRWCompact(Number(v)) },
      grid: { color: '#f1f5f9' }
    }
  }
}))
</script>

<template>
  <section class="card">
    <h3 class="font-semibold text-slate-900">월별 × 카테고리 누적</h3>
    <p class="text-xs text-slate-500 mb-3">상위 6개 카테고리 기준 월별 구성</p>
    <!-- 차트 높이: viewport 비례. 4K에서도 자연스럽게 커짐 -->
    <div class="h-chart-md xl:h-chart-lg">
      <Bar v-if="stack.months.length" :data="chartData" :options="chartOptions" />
      <div v-else class="h-full grid place-items-center text-sm text-slate-400">데이터가 없습니다.</div>
    </div>
  </section>
</template>
