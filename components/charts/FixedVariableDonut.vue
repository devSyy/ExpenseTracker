<script setup lang="ts">
import { computed } from 'vue'
import { Doughnut } from 'vue-chartjs'
import { useExpenses } from '~/composables/useExpenses'
import { summarizeFixedVariable } from '~/utils/aggregate'
import { formatKRW, formatPercent } from '~/utils/format'
import { FIXED_COLOR, VARIABLE_COLOR } from '~/utils/palette'

const { filtered } = useExpenses()
const summary = computed(() => summarizeFixedVariable(filtered.value))

const chartData = computed(() => ({
  labels: ['고정비', '변동비'],
  datasets: [
    {
      data: [summary.value.fixed, summary.value.variable],
      backgroundColor: [FIXED_COLOR, VARIABLE_COLOR],
      borderColor: '#ffffff',
      borderWidth: 2
    }
  ]
}))

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '60%',
  plugins: {
    legend: { position: 'bottom' as const },
    tooltip: {
      callbacks: {
        label: (ctx: any) => {
          const total = ctx.dataset.data.reduce((a: number, b: number) => a + b, 0) || 1
          const pct = (ctx.parsed / total) * 100
          return `${ctx.label}: ${formatKRW(ctx.parsed)} (${formatPercent(pct)})`
        }
      }
    }
  }
}
</script>

<template>
  <section class="card">
    <h3 class="font-semibold text-slate-900">고정비 vs 변동비</h3>
    <p class="text-xs text-slate-500 mb-3">고정비 비율이 높을수록 지출 구조가 경직적입니다</p>
    <div class="h-chart-sm xl:h-chart-md">
      <Doughnut v-if="summary.total > 0" :data="chartData" :options="chartOptions" />
      <div v-else class="h-full grid place-items-center text-sm text-slate-400">데이터가 없습니다.</div>
    </div>
    <div v-if="summary.total > 0" class="mt-3 text-sm text-slate-600 flex justify-between">
      <span>고정 {{ formatPercent(summary.fixedShare * 100) }}</span>
      <span>변동 {{ formatPercent(summary.variableShare * 100) }}</span>
    </div>
  </section>
</template>
