<script setup lang="ts">
// 증감 배지 — "직전 기간 대비 얼마나 늘었나/줄었나"를 한 눈에.
//
// 색 규칙: 지출은 **늘면 나쁨**(빨강), 줄면 좋음(초록). 수입은 그 반대다.
// 그래서 방향만 보고 색을 정하지 않고 goodWhen으로 의미를 받는다.
// 색만으로 말하지 않기 위해 화살표(▲▼)와 부호를 항상 함께 적는다.
import { computed } from 'vue'
import { formatKRW, formatPercent } from '~/utils/format'

const props = withDefaults(defineProps<{
  /** 현재 값 */
  current: number
  /** 비교 기준값 */
  base: number
  /** 비교 기준 기간 이름 (툴팁에 표시) */
  baseLabel?: string
  /** 값이 늘어나는 것이 좋은 지표인지 — 지출은 false, 수입은 true */
  goodWhen?: 'up' | 'down'
  /** 금액 차이도 함께 표시 */
  showAmount?: boolean
  /** 작은 크기 */
  small?: boolean
}>(), {
  baseLabel: '',
  goodWhen: 'down',
  showAmount: false,
  small: false
})

/** 증감률 — 기준값이 0이면 비율을 낼 수 없다 */
const rate = computed<number | null>(() => {
  if (!Number.isFinite(props.current) || !Number.isFinite(props.base) || props.base === 0) return null
  return ((props.current - props.base) / Math.abs(props.base)) * 100
})

const diff = computed(() => props.current - props.base)

/** 0.05% 미만은 변화 없음으로 취급 — 반올림 잡음이 ▲0.0%로 보이지 않게 */
const direction = computed<'up' | 'down' | 'flat'>(() => {
  if (rate.value === null) return props.base === 0 && props.current > 0 ? 'up' : 'flat'
  if (Math.abs(rate.value) < 0.05) return 'flat'
  return rate.value > 0 ? 'up' : 'down'
})

const tone = computed<'good' | 'bad' | 'flat'>(() => {
  if (direction.value === 'flat') return 'flat'
  const isGood = props.goodWhen === 'up' ? direction.value === 'up' : direction.value === 'down'
  return isGood ? 'good' : 'bad'
})

const arrow = computed(() => (direction.value === 'up' ? '▲' : direction.value === 'down' ? '▼' : '–'))

const rateText = computed(() => {
  if (direction.value === 'flat') return '변화 없음'
  // 기준값이 0인데 값이 생긴 경우는 비율 대신 '신규'로 적는다
  if (rate.value === null) return '신규'
  return formatPercent(Math.abs(rate.value))
})

const title = computed(() => {
  const base = props.baseLabel ? `${props.baseLabel} ${formatKRW(props.base)}` : formatKRW(props.base)
  if (direction.value === 'flat') return `${base} 대비 변화 없음`
  const sign = diff.value > 0 ? '+' : '−'
  return `${base} 대비 ${sign}${formatKRW(Math.abs(diff.value))}`
})
</script>

<template>
  <span :class="['delta', `is-${tone}`, small ? 'is-small' : '']" :title="title">
    <span class="delta-arrow" aria-hidden="true">{{ arrow }}</span>
    <span>{{ rateText }}</span>
    <span v-if="showAmount && direction !== 'flat'" class="delta-amount">
      {{ diff > 0 ? '+' : '−' }}{{ formatKRW(Math.abs(diff)) }}
    </span>
  </span>
</template>

<style scoped>
.delta {
  display: inline-flex;
  align-items: center;
  gap: 0.1875rem;
  font-size: 0.6875rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.4;
  white-space: nowrap;
}
.delta.is-small { font-size: 0.625rem; }
/* 지출이 줄었을 때 = 좋음 */
.delta.is-good { color: rgb(4 120 87); }    /* emerald-700 */
.delta.is-bad  { color: rgb(190 18 60); }   /* rose-700 */
.delta.is-flat { color: rgb(148 163 184); } /* slate-400 */
.delta-arrow { font-size: 0.5625rem; }
.delta-amount {
  font-weight: 500;
  color: rgb(148 163 184);
}
</style>
