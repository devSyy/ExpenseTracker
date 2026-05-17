<script setup lang="ts">
import { computed, watch } from 'vue'
import { useExpenses } from '~/composables/useExpenses'

const { transactions, warnings, reapplyDescriptionRules } = useExpenses()
const hasData = computed(() => transactions.value.length > 0)

// 거래가 새로 로드될 때마다(파일 업로드/새로고침 후 localStorage 복원 등)
// 내용 기반 분류 룰을 자동 적용한다. 예: "출금 내역" / "입금 내역" → "입출금".
watch(
  () => transactions.value.length,
  (n, prev) => {
    if (n > 0 && n !== prev) reapplyDescriptionRules()
  },
  { immediate: true }
)
</script>

<template>
  <!--
    페이지 컨테이너:
    - 모바일/태블릿: 화면 폭 그대로(좌우 패딩만)
    - 노트북(1280+): 1360px
    - QHD(1792+): 1700px
    - 4K(2240+): 2000px / 울트라와이드(2880+): 2400px
    .page-shell 정의는 assets/css/tailwind.css 참고
   -->
  <div class="page-shell section-gap">
    <UploadCard />

    <div v-if="warnings.length > 0" class="card border-amber-200 bg-amber-50 ring-amber-200">
      <h3 class="font-semibold text-amber-800">주의</h3>
      <ul class="mt-2 list-disc list-inside text-sm text-amber-800 space-y-1">
        <li v-for="w in warnings" :key="w">{{ w }}</li>
      </ul>
    </div>

    <template v-if="hasData">
      <FiltersBar />
      <KPICards />

      <!--
        차트 그리드:
        - <md (모바일/좁은 태블릿): 1컬럼 세로 적층
        - md~lg (태블릿): 메인 차트만 가로 풀폭, 보조 차트는 아래
        - lg~3xl (일반 데스크톱): 메인 2/3 + 보조 1/3
        - 3xl+ (1792+ FHD/QHD): 메인 3/4 + 보조 1/4 — 보조가 너무 커지지 않도록 비율 조정
       -->
      <div class="grid grid-cols-1 lg:grid-cols-3 3xl:grid-cols-4 gap-4">
        <div class="lg:col-span-2 3xl:col-span-3">
          <ChartsPeriodTrendChart />
        </div>
        <ChartsFixedVariableDonut />
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 3xl:grid-cols-4 gap-4">
        <div class="lg:col-span-2 3xl:col-span-3">
          <ChartsCategoryStack />
        </div>
        <ChartsCategoryDonut />
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 3xl:grid-cols-4 gap-4">
        <div class="lg:col-span-2 3xl:col-span-3">
          <ChartsPaymentBar />
        </div>
        <CategoryLeaderboard />
      </div>

      <TransactionsTable />
    </template>

    <section v-else class="card">
      <div class="py-10 text-center">
        <div class="text-4xl">📊</div>
        <h3 class="mt-3 text-lg font-semibold text-slate-900">아직 불러온 가계부가 없습니다</h3>
        <p class="mt-1 text-sm text-slate-500">
          위에서 엑셀 파일을 업로드하거나 샘플 데이터를 불러와 대시보드를 둘러보세요.
        </p>

        <div class="mt-8 text-left max-w-2xl mx-auto grid sm:grid-cols-2 gap-4">
          <div class="rounded-xl border border-slate-200 p-4">
            <div class="text-xs font-semibold text-slate-500 uppercase">자동 분류</div>
            <ul class="mt-2 text-sm text-slate-700 space-y-1">
              <li>· 기간: 주/월/분기/반기/연도</li>
              <li>· 구분: 고정비 / 변동비</li>
              <li>· 카테고리: 식비·마트·공과금·통신·대출이자 등</li>
              <li>· 결제수단: 롯데·삼성·지역화폐·신한체크·토스1/2</li>
            </ul>
          </div>
          <div class="rounded-xl border border-slate-200 p-4">
            <div class="text-xs font-semibold text-slate-500 uppercase">필요한 열</div>
            <ul class="mt-2 text-sm text-slate-700 space-y-1">
              <li>· <b>날짜</b> (필수) – 예: 2026-01-15</li>
              <li>· <b>금액</b> (필수) – 예: 15,900</li>
              <li>· 내용 · 카테고리 · 결제수단 · 구분</li>
              <li>· 헤더명은 한/영 모두 자동 인식</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
