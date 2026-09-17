<script setup lang="ts">
import { computed } from 'vue'
import { useExpenses } from '~/composables/useExpenses'
import { useTaxonomies } from '~/composables/useTaxonomies'
import { computeKPIs } from '~/utils/aggregate'
import { formatKRW, formatNumber, formatDate, formatPercent } from '~/utils/format'

const {
  filtered, incomeFiltered, incomeTotal, netTotal, periodComparison,
  savingsTotal, savingsSummary, savingsRate
} = useExpenses()
const { savingsPaymentNames } = useTaxonomies()
const kpi = computed(() => computeKPIs(filtered.value))

const dateRangeLabel = computed(() => {
  const { start, end } = kpi.value.dateRange
  if (!start || !end) return '–'
  return `${formatDate(start)} ~ ${formatDate(end)}`
})

// ── 기간 비교 ──
// 연+월이 선택되어 있으면 직전 달·전년 동월, 연만 선택되어 있으면 직전 해와 비교한다.
// 전체 기간을 보고 있을 때는 비교 대상이 정의되지 않으므로 배지를 아예 그리지 않는다.
const cmp = computed(() => periodComparison.value)
const prev = computed(() => cmp.value.previous)
const lastYear = computed(() => cmp.value.lastYear)

/** 비교 기준 이름 — "지난달" / "지난해" */
const prevName = computed(() => (cmp.value.unit === 'month' ? '지난달' : '지난해'))

/** 기준 기간에 데이터가 아예 없으면 배지가 의미 없다 */
function hasBase(base: { expense: number; income: number; count: number } | null): boolean {
  return Boolean(base && (base.expense > 0 || base.income > 0 || base.count > 0))
}
const showPrev = computed(() => hasBase(prev.value))
const showLastYear = computed(() => cmp.value.unit === 'month' && hasBase(lastYear.value))

// ── 월 저축 금액 ──
//
// "저축" 판정은 **결제수단의 저축 태그**(설정 > 결제수단) 하나만 본다.
// 값은 월 환산이다: 한 달만 선택했으면 그 달의 합계와 같고, 여러 달이 걸쳐 있으면
// 개월 수로 나눈 값이므로 카드 제목의 '월'이 어떤 필터에서도 사실이 된다.
const savingsMonthly = computed(() => savingsSummary.value.monthly)

/** 저축 태그를 붙인 결제수단이 하나도 없으면 값이 늘 0이므로, 설정으로 안내한다 */
const hasSavingsPayment = computed(() => savingsPaymentNames.value.length > 0)

/** 여러 달이 걸쳐 있는지 — 그때만 '월 환산'임을 밝힌다 */
const savingsSpansMonths = computed(() => savingsSummary.value.months > 1)

// ── 수입 ──
// '수입' 유형 카테고리(설정 > 카테고리)로 분류된 거래만 집계된다.
// 수입 거래가 없어도 카드는 항상 그리고, 대신 안내 문구로 왜 0인지 알린다.
const incomeCount = computed(() => incomeFiltered.value.length)
</script>

<template>
  <!--
    KPI 5장 (총 수입 · 총 지출 · 월 저축 · 고정비 · 변동비):
    - 모든 폰 (<sm 640): 2컬럼
    - sm~lg (큰 폰/태블릿): 2컬럼 유지 (1024 미만에선 카드가 너무 좁아짐)
    - lg~xl (1024+): 3컬럼
    - xl+ (1280+): 5컬럼 한 줄
   -->
  <section class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
    <!--
      총 수입 — '수입' 유형 카테고리 거래의 합계.
      수입은 늘어나는 쪽이 좋으므로 증감 배지 방향이 지출과 반대다(goodWhen='up').
    -->
    <div class="card">
      <div class="kpi-label">총 수입</div>
      <div class="kpi-value mt-1 text-blue-600">{{ formatKRW(incomeTotal) }}</div>

      <div v-if="showPrev && prev && prev.income > 0" class="mt-1.5 flex items-center gap-1.5 flex-wrap">
        <DeltaBadge
          :current="incomeTotal"
          :base="prev.income"
          :base-label="`${prevName}(${prev.label}) 수입`"
          good-when="up"
          show-amount
        />
        <span class="text-[10px] text-slate-400">{{ prevName }} 대비</span>
      </div>
      <div v-if="showLastYear && lastYear && lastYear.income > 0" class="mt-0.5 flex items-center gap-1.5 flex-wrap">
        <DeltaBadge
          :current="incomeTotal"
          :base="lastYear.income"
          :base-label="`전년 동월(${lastYear.label}) 수입`"
          good-when="up"
          small
        />
        <span class="text-[10px] text-slate-400">전년 동월 대비</span>
      </div>

      <div class="mt-2 text-xs text-slate-500">
        <template v-if="incomeCount > 0">
          순수익
          <span :class="netTotal >= 0 ? 'text-emerald-600 font-medium' : 'text-rose-600 font-medium'">
            {{ formatKRW(netTotal) }}
          </span>
          <span class="text-slate-400"> · {{ formatNumber(incomeCount) }}건</span>
        </template>
        <template v-else>
          이 기간에 수입 거래 없음 — 설정 &gt; 카테고리에서 유형을 <b class="text-slate-700">수입</b>으로 지정하세요
        </template>
      </div>
    </div>
    <div class="card">
      <div class="kpi-label">총 지출</div>
      <div class="kpi-value mt-1">{{ formatKRW(kpi.total) }}</div>

      <!-- 직전 기간 대비 — 지출은 줄어드는 쪽이 좋다 -->
      <div v-if="showPrev && prev" class="mt-1.5 flex items-center gap-1.5 flex-wrap">
        <DeltaBadge
          :current="kpi.total"
          :base="prev.expense"
          :base-label="`${prevName}(${prev.label})`"
          good-when="down"
          show-amount
        />
        <span class="text-[10px] text-slate-400">{{ prevName }} 대비</span>
      </div>
      <!-- 전년 동월 — 월 단위로 볼 때만 -->
      <div v-if="showLastYear && lastYear" class="mt-0.5 flex items-center gap-1.5 flex-wrap">
        <DeltaBadge
          :current="kpi.total"
          :base="lastYear.expense"
          :base-label="`전년 동월(${lastYear.label})`"
          good-when="down"
          small
        />
        <span class="text-[10px] text-slate-400">전년 동월 대비</span>
      </div>

      <div class="mt-2 text-xs text-slate-500">{{ dateRangeLabel }}</div>
    </div>
    <!--
      월 저축 금액 — 결제수단에 '저축' 태그가 붙은 거래의 합계.
      저축은 늘어나는 쪽이 좋으므로 증감 배지의 방향 의미가 지출과 반대다(goodWhen='up').
    -->
    <div class="card">
      <div class="kpi-label">월 저축 금액</div>
      <div class="kpi-value mt-1 text-teal-700">{{ formatKRW(savingsMonthly) }}</div>

      <div v-if="showPrev && prev && prev.savings > 0" class="mt-1.5">
        <DeltaBadge
          :current="savingsTotal"
          :base="prev.savings"
          :base-label="`${prevName}(${prev.label}) 저축`"
          good-when="up"
        />
      </div>

      <div class="mt-2 text-xs text-slate-500">
        <template v-if="!hasSavingsPayment">
          설정 &gt; 결제수단에서 <b class="text-slate-700">저축 태그</b>를 지정하세요
        </template>
        <template v-else-if="savingsSummary.count === 0">
          이 기간에 저축 태그 거래 없음
        </template>
        <template v-else>
          <span v-if="savingsRate !== null">수입의 {{ formatPercent(savingsRate * 100) }}</span>
          <span v-else>{{ formatNumber(savingsSummary.count) }}건</span>
          <span v-if="savingsSpansMonths" class="text-slate-400">
            · {{ savingsSummary.months }}개월 월 환산 (합계 {{ formatKRW(savingsTotal) }})
          </span>
        </template>
      </div>
    </div>
    <div class="card">
      <div class="kpi-label">고정비</div>
      <div class="kpi-value mt-1 text-brand-700">{{ formatKRW(kpi.fixed) }}</div>
      <div v-if="showPrev && prev && prev.fixed > 0" class="mt-1.5">
        <DeltaBadge
          :current="kpi.fixed"
          :base="prev.fixed"
          :base-label="`${prevName}(${prev.label}) 고정비`"
          good-when="down"
        />
      </div>
      <div class="mt-2 text-xs text-slate-500">공과금·통신·대출이자 등</div>
    </div>
    <div class="card">
      <div class="kpi-label">변동비</div>
      <div class="kpi-value mt-1 text-amber-600">{{ formatKRW(kpi.variable) }}</div>
      <div v-if="showPrev && prev && prev.variable > 0" class="mt-1.5">
        <DeltaBadge
          :current="kpi.variable"
          :base="prev.variable"
          :base-label="`${prevName}(${prev.label}) 변동비`"
          good-when="down"
        />
      </div>
      <div class="mt-2 text-xs text-slate-500">
        주요 카테고리: <span class="font-medium text-slate-700">{{ kpi.topCategory ?? '–' }}</span>
      </div>
    </div>
  </section>
</template>
