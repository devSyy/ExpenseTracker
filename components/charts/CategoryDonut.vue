<script setup lang="ts">
import { computed } from 'vue'
import { Doughnut } from 'vue-chartjs'
import { useExpenses } from '~/composables/useExpenses'
import { bucketByCategory } from '~/utils/aggregate'
import { formatKRW, formatPercent } from '~/utils/format'
import { pickColors } from '~/utils/palette'

const { filtered } = useExpenses()
const rows = computed(() => bucketByCategory(filtered.value))

const chartData = computed(() => {
  const top = rows.value.slice(0, 8)
  const others = rows.value.slice(8)
  const labels = top.map((r) => r.category)
  const values = top.map((r) => r.total)
  if (others.length > 0) {
    labels.push('기타 (그 외)')
    values.push(others.reduce((s, r) => s + r.total, 0))
  }
  return {
    labels,
    datasets: [
      {
        data: values,
        backgroundColor: pickColors(labels.length),
        borderColor: '#ffffff',
        borderWidth: 2
      }
    ]
  }
})

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '55%',
  plugins: {
    legend: { position: 'right' as const, labels: { boxWidth: 12 } },
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
    <h3 class="font-semibold text-slate-900">카테고리별 지출</h3>
    <p class="text-xs text-slate-500 mb-3">상위 8개 카테고리 + 나머지</p>
    <!-- 도넛은 너무 커지면 어색하므로 chart-sm 단계 사용 -->
    <div class="h-chart-sm xl:h-chart-md">
      <Doughnut v-if="rows.length" :data="chartData" :options="chartOptions" />
      <div v-else class="h-full grid place-items-center text-sm text-slate-400">데이터가 없습니다.</div>
    </div>
  </section>
</template>
