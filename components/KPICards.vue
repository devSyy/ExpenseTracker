<script setup lang="ts">
import { computed } from 'vue'
import { useExpenses } from '~/composables/useExpenses'
import { computeKPIs } from '~/utils/aggregate'
import { formatKRW, formatNumber, formatDate } from '~/utils/format'

const { filtered, incomeTotal, netTotal } = useExpenses()
const kpi = computed(() => computeKPIs(filtered.value))

const dateRangeLabel = computed(() => {
  const { start, end } = kpi.value.dateRange
  if (!start || !end) return '–'
  return `${formatDate(start)} ~ ${formatDate(end)}`
})
</script>

<template>
  <!--
    KPI 4장:
    - 모든 폰 (<sm 640): 2컬럼 — 한 화면에 4장 정보 모두 보이도록
    - sm~lg (큰 폰/태블릿): 2컬럼 유지 (lg-cols-4가 1024 미만에선 카드가 너무 좁아짐)
    - lg+ (1024+): 4컬럼
   -->
  <section class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
    <div class="card">
      <div class="kpi-label">총 지출</div>
      <div class="kpi-value mt-1">{{ formatKRW(kpi.total) }}</div>
      <div class="mt-2 text-xs text-slate-500">{{ dateRangeLabel }}</div>
      <!-- 수입 카테고리 거래가 있을 때만 노출 (기존 4장 레이아웃 유지) -->
      <div v-if="incomeTotal > 0" class="mt-1 text-xs">
        <span class="text-blue-600 font-medium">수입 {{ formatKRW(incomeTotal) }}</span>
        <span class="text-slate-400"> · 순수익 </span>
        <span :class="netTotal >= 0 ? 'text-emerald-600 font-medium' : 'text-rose-600 font-medium'">
          {{ formatKRW(netTotal) }}
        </span>
      </div>
    </div>
    <div class="card">
      <div class="kpi-label">월평균 지출</div>
      <div class="kpi-value mt-1">{{ formatKRW(kpi.avgMonthly) }}</div>
      <div class="mt-2 text-xs text-slate-500">필터 반영 · 거래 {{ formatNumber(kpi.count) }}건</div>
    </div>
    <div class="card">
      <div class="kpi-label">고정비</div>
      <div class="kpi-value mt-1 text-brand-700">{{ formatKRW(kpi.fixed) }}</div>
      <div class="mt-2 text-xs text-slate-500">공과금·통신·대출이자 등</div>
    </div>
    <div class="card">
      <div class="kpi-label">변동비</div>
      <div class="kpi-value mt-1 text-amber-600">{{ formatKRW(kpi.variable) }}</div>
      <div class="mt-2 text-xs text-slate-500">
        주요 카테고리: <span class="font-medium text-slate-700">{{ kpi.topCategory ?? '–' }}</span>
      </div>
    </div>
  </section>
</template>
