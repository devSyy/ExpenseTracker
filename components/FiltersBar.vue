<script setup lang="ts">
// 필터 바.
// 카테고리/결제수단 옵션은 useTaxonomies()의 reactive 목록에서 가져온다.
// 숨김 처리된 항목은 옵션에서 자동으로 빠지지만, 현재 선택된 값이 숨김 항목인 경우엔
// 옵션이 사라지지 않도록 임시로 노출한다.
//
// 모바일(<sm)에서는 6개 입력이 6줄을 차지하지 않도록 핵심 필터만 노출하고
// 나머지(카테고리/결제수단/구분)는 "고급 필터" 토글 뒤로 접는다.
// 데스크톱(sm+)에서는 모두 펼쳐서 한눈에 본다.
import { computed, ref } from 'vue'
import { useExpenses } from '~/composables/useExpenses'
import { useTaxonomies } from '~/composables/useTaxonomies'

const {
  filters, availableYears, availableMonths, fileName,
  transactions, filteredAll, hasPeriodFilter, clearPeriodFilter
} = useExpenses()

// 기본 기간이 "올해·이번 달"이므로, 과거 기간 파일을 올리면 화면이 비어 보일 수 있다.
// 그 상황을 감지해 전체 기간으로 되돌릴 수 있는 안내를 띄운다.
const periodHidesEverything = computed(
  () => transactions.value.length > 0 && filteredAll.value.length === 0 && hasPeriodFilter.value
)
const { visibleCategoryNames, visiblePaymentNames } = useTaxonomies()

// "이번달" 빠른 선택: 현재 월 데이터로 연도+월을 한 번에 설정
function selectThisMonth() {
  const now = new Date()
  filters.year = now.getFullYear()
  filters.month = now.getMonth() + 1
}
function clearMonth() {
  filters.month = 'all'
}
const isThisMonth = computed(() => {
  const now = new Date()
  return filters.year === now.getFullYear() && filters.month === now.getMonth() + 1
})

const categoryOptions = computed<string[]>(() => {
  const cur = filters.category
  if (cur !== 'all' && !visibleCategoryNames.value.includes(cur)) {
    return [...visibleCategoryNames.value, cur]
  }
  return visibleCategoryNames.value
})

const paymentOptions = computed<string[]>(() => {
  const cur = filters.payment
  if (cur !== 'all' && !visiblePaymentNames.value.includes(cur)) {
    return [...visiblePaymentNames.value, cur]
  }
  return visiblePaymentNames.value
})

// 모바일 고급 필터 펼침 토글
const advancedOpen = ref(false)

// 고급 필터에 비-기본값이 하나라도 있으면 작은 점 표시(사용자에게 알려주기)
const hasAdvancedFilters = computed(() =>
  filters.category !== 'all' || filters.payment !== 'all' || filters.costType !== 'all'
)

function clearAdvanced() {
  filters.category = 'all'
  filters.payment = 'all'
  filters.costType = 'all'
}
</script>

<template>
  <section class="card">
    <div class="flex flex-wrap items-end gap-3 sm:gap-4">
      <!-- 연도 -->
      <div class="min-w-[7rem] sm:min-w-[8rem] flex-1 sm:flex-none">
        <label class="kpi-label">연도</label>
        <select v-model="filters.year" class="mt-1 w-full rounded-md border-slate-300 focus:border-brand-500 focus:ring-brand-500">
          <option value="all">전체</option>
          <option v-for="y in availableYears" :key="y" :value="y">{{ y }}년</option>
        </select>
      </div>
      <!-- 월 + 이번달 빠른 선택 -->
      <div class="min-w-[7rem] sm:min-w-[8rem] flex-1 sm:flex-none">
        <label class="kpi-label flex items-center justify-between">
          <span>월</span>
          <button
            v-if="filters.month !== 'all'"
            type="button"
            class="text-[10px] text-slate-400 hover:text-slate-700 underline"
            @click="clearMonth"
          >해제</button>
        </label>
        <div class="mt-1 flex gap-1">
          <select v-model="filters.month" class="flex-1 min-w-0 rounded-md border-slate-300 focus:border-brand-500 focus:ring-brand-500">
            <option value="all">전체</option>
            <option v-for="m in availableMonths" :key="m" :value="m">{{ m }}월</option>
          </select>
          <button
            type="button"
            :class="[
              'px-2 rounded-md border text-xs whitespace-nowrap transition-colors',
              isThisMonth
                ? 'bg-brand-600 border-brand-600 text-white'
                : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
            ]"
            title="이번 달로 빠르게 설정"
            @click="selectThisMonth"
          >이번달</button>
        </div>
      </div>

      <!--
        카테고리/결제수단/구분 — 모바일에선 advancedOpen 토글 시에만 보이고
        sm+에서는 항상 펼쳐 보임.
       -->
      <div :class="['min-w-[10rem] sm:min-w-[12rem] flex-1 sm:flex-none', advancedOpen ? 'block' : 'hidden sm:block']">
        <label class="kpi-label">카테고리</label>
        <select v-model="filters.category" class="mt-1 w-full rounded-md border-slate-300 focus:border-brand-500 focus:ring-brand-500">
          <option value="all">전체</option>
          <option v-for="c in categoryOptions" :key="c" :value="c">{{ c }}</option>
        </select>
      </div>
      <div :class="['min-w-[10rem] sm:min-w-[12rem] flex-1 sm:flex-none', advancedOpen ? 'block' : 'hidden sm:block']">
        <label class="kpi-label">결제수단</label>
        <select v-model="filters.payment" class="mt-1 w-full rounded-md border-slate-300 focus:border-brand-500 focus:ring-brand-500">
          <option value="all">전체</option>
          <option v-for="p in paymentOptions" :key="p" :value="p">{{ p }}</option>
        </select>
      </div>
      <div :class="['min-w-[8rem] sm:min-w-[10rem] flex-1 sm:flex-none', advancedOpen ? 'block' : 'hidden sm:block']">
        <label class="kpi-label">비용 구분</label>
        <select v-model="filters.costType" class="mt-1 w-full rounded-md border-slate-300 focus:border-brand-500 focus:ring-brand-500">
          <option value="all">전체</option>
          <option value="고정비">고정비</option>
          <option value="변동비">변동비</option>
        </select>
      </div>

      <!-- 검색 — 항상 노출. 모바일에서 너무 좁아지지 않도록 min-w 12rem -->
      <div class="flex-1 min-w-[12rem] sm:min-w-[16rem]">
        <label class="kpi-label">검색</label>
        <input
          v-model="filters.search"
          type="text"
          placeholder="가맹점·메모·카테고리 검색"
          class="mt-1 w-full rounded-md border-slate-300 focus:border-brand-500 focus:ring-brand-500"
        />
      </div>
    </div>

    <!--
      모바일 전용: "고급 필터" 토글 + 한꺼번에 해제 버튼.
      sm+ 에서는 숨김 (이미 위에서 모두 펼쳐져 있음).
     -->
    <div class="mt-3 sm:hidden flex items-center gap-2">
      <button
        type="button"
        class="adv-toggle"
        :aria-expanded="advancedOpen"
        @click="advancedOpen = !advancedOpen"
      >
        <span>{{ advancedOpen ? '필터 접기' : '필터 더보기' }}</span>
        <span
          v-if="hasAdvancedFilters && !advancedOpen"
          class="adv-dot"
          aria-label="활성 필터 있음"
        ></span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          :class="['adv-chevron', advancedOpen ? 'is-open' : '']"
        ><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <button
        v-if="hasAdvancedFilters"
        type="button"
        class="text-[11px] text-slate-500 hover:text-slate-800 underline"
        @click="clearAdvanced"
      >
        고급 필터 해제
      </button>
    </div>

    <div v-if="fileName" class="mt-3 text-xs text-slate-500">
      불러온 파일: <span class="font-medium text-slate-700">{{ fileName }}</span>
    </div>

    <!-- 기간 필터 때문에 아무것도 안 보일 때 안내 -->
    <p
      v-if="periodHidesEverything"
      class="mt-3 flex items-center justify-between gap-2 flex-wrap rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800"
    >
      <span>
        선택한 기간({{ filters.year === 'all' ? '전체' : filters.year + '년' }}{{ filters.month === 'all' ? '' : ' ' + filters.month + '월' }})에 해당하는 거래가 없습니다.
        불러온 데이터가 다른 기간일 수 있습니다.
      </span>
      <button
        type="button"
        class="px-2 py-1 rounded border border-amber-300 bg-white text-amber-800 hover:bg-amber-100 whitespace-nowrap"
        @click="clearPeriodFilter"
      >전체 기간 보기</button>
    </p>
  </section>
</template>

<style scoped>
.adv-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid rgb(203 213 225);
  background: #fff;
  color: rgb(51 65 85);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.adv-toggle:hover {
  background: rgb(248 250 252);
}
.adv-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: rgb(37 99 235);
}
.adv-chevron {
  transition: transform 0.15s ease;
}
.adv-chevron.is-open {
  transform: rotate(180deg);
}
</style>
