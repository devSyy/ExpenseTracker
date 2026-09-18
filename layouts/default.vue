<script setup lang="ts">
// 앱 전역 레이아웃: 좌측 사이드바(브랜드+가족+메뉴+요약) + 본문 영역.
// 데스크톱에서는 사용자가 사이드바를 아이콘 전용 모드로 접을 수 있다(상태 localStorage 보존).
// 좁은 데스크톱(< xl 1280px)에서는 처음 진입 시 자동으로 콤팩트 모드로 시작해
// 본문 공간을 우선 확보한다.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useIncomeExpense } from '~/composables/useIncomeExpense'
import { useExpenses } from '~/composables/useExpenses'
import { useFamily } from '~/composables/useFamily'

// 수입/지출 관리 ↔ 대시보드 미러링 감시자는 useIncomeExpense 모듈을 불러오는 시점에 등록된다.
// 어느 페이지로 진입하든 미러링이 살아 있도록 레이아웃에서 한 번 호출해 둔다.
useIncomeExpense()

const { monthSummary } = useExpenses()
const {
  familyName,
  setFamilyName,
  members,
  primaryMemberId,
  isActive,
  toggleActive,
  setPrimary,
  activateAll
} = useFamily()

// ── 가족 이름 인라인 편집 ──
// 사이드바 이름을 눌러 바로 고칠 수 있다. 저장은 useFamily().setFamilyName() 한 곳으로만 간다
// (가족 관리 화면의 편집과 동일한 경로 — 빈 값이면 기본 이름으로 되돌아간다).
const editingName = ref(false)
const nameDraft = ref('')
const nameInput = ref<HTMLInputElement | null>(null)

async function startEditName() {
  nameDraft.value = familyName.value
  editingName.value = true
  await nextTick()
  nameInput.value?.select()
}

function commitName() {
  if (!editingName.value) return
  editingName.value = false
  const next = nameDraft.value.trim()
  if (next && next !== familyName.value) setFamilyName(next)
}

function cancelName() {
  editingName.value = false
}

// ── 이번 달 요약 ──
//
// 집계는 useExpenses().monthSummary() 한 곳에서만 한다. 저장소(거래 목록)를 직접 읽으므로
// 엑셀 업로드·거래 추가/편집/삭제·수입/지출 관리의 미러링까지 모든 변경이 자동 반영된다.
// (수입/지출 관리에서 '사용내역 가져오기'로 들어온 항목은 원본이 이미 거래 목록에 있어
//  대시보드 쪽만 세면 중복 없이 전체가 된다.)
//
// 기준 시각은 ref로 들고 간다 — SPA라 탭을 오래 열어둬도 자정·월이 바뀌면 요약이 따라가야 한다.
// 또한 toISOString()은 UTC라 KST에서는 매월 1일 오전 9시 이전이 지난달로 잡히므로 로컬 기준으로 만든다.
const nowRef = ref(new Date())
let monthTimer: number | undefined

function refreshNow() {
  nowRef.value = new Date()
}

onMounted(() => {
  monthTimer = window.setInterval(refreshNow, 60_000)
  window.addEventListener('focus', refreshNow)
  document.addEventListener('visibilitychange', refreshNow)
})

onBeforeUnmount(() => {
  if (monthTimer) window.clearInterval(monthTimer)
  monthTimer = undefined
  window.removeEventListener('focus', refreshNow)
  document.removeEventListener('visibilitychange', refreshNow)
})

/** 이번 달 — 값이 원시형이라 실제로 달이 바뀔 때만 아래 계산이 다시 돈다 */
const currentYear = computed(() => nowRef.value.getFullYear())
const currentMonth = computed(() => nowRef.value.getMonth() + 1)

const stats = computed(() => monthSummary(currentYear.value, currentMonth.value))

const monthRangeLabel = computed(() => {
  const y = currentYear.value
  const m = currentMonth.value
  const lastDay = new Date(y, m, 0).getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${y}.${pad(m)}.01 ~ ${y}.${pad(m)}.${pad(lastDay)}`
})

function fmt(n: number): string {
  return Number.isFinite(n) ? Number(n).toLocaleString('ko-KR') + '원' : '–'
}

// ─────────────────────────────────────────
// 사이드바 상태
// - sidebarOpen: 모바일에서 슬라이드 오버레이 열림 여부
// - sidebarCollapsed: 데스크톱에서 아이콘 전용 모드 여부
// ─────────────────────────────────────────
const sidebarOpen = ref(false)
const sidebarCollapsed = ref(false)
const STORAGE_KEY = 'sidebar.collapsed.v1'

onMounted(() => {
  // 1순위: 사용자가 명시적으로 저장한 값
  const saved = window.localStorage.getItem(STORAGE_KEY)
  if (saved === 'true') {
    sidebarCollapsed.value = true
    return
  }
  if (saved === 'false') {
    sidebarCollapsed.value = false
    return
  }
  // 2순위: 첫 진입이면 화면 폭 기반 자동 결정
  // 노트북(< 1280)에서는 콤팩트로 시작해서 본문 공간을 우선 확보
  if (window.matchMedia('(max-width: 1279px)').matches) {
    sidebarCollapsed.value = true
  }
})

watch(sidebarCollapsed, (v) => {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, String(v))
  }
})

function toggleCollapsed() {
  sidebarCollapsed.value = !sidebarCollapsed.value
}

// 메뉴 아이템 공통 클래스
const navItem = 'flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors'
const navItemDisabled = 'flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-400 cursor-not-allowed select-none'
const navSub = 'block px-3 py-1.5 rounded-md text-xs text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors'
</script>

<template>
  <div class="min-h-screen flex bg-slate-50">
    <!-- 사이드바 -->
    <!-- 모바일: 슬라이드 오버레이 / 데스크톱: sticky + 폭 토글 -->
    <aside
      :class="[
        'sidebar-base',
        sidebarOpen ? 'is-open' : '',
        sidebarCollapsed ? 'sidebar-collapsed' : ''
      ]"
    >
      <!-- 로고 + 가족 이름 -->
      <div class="px-4 py-4 flex items-center gap-2.5">
        <div class="w-9 h-9 flex-shrink-0 rounded-xl bg-brand-600 text-white grid place-items-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>
        </div>
        <div class="leading-tight collapsible-text min-w-0">
          <div class="text-[10px] font-medium text-slate-400 tracking-wide">FAMILY</div>
          <!-- 이름을 눌러 바로 수정 (Enter 저장 · Esc 취소 · 포커스가 빠져도 저장) -->
          <input
            v-if="editingName"
            ref="nameInput"
            v-model="nameDraft"
            type="text"
            maxlength="20"
            class="w-full text-base font-bold text-slate-900 bg-white border border-brand-300 rounded-md px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-brand-200"
            placeholder="우리 가족"
            aria-label="가족 이름"
            @keydown.enter.prevent="commitName"
            @keydown.esc.prevent="cancelName"
            @blur="commitName"
          />
          <button
            v-else
            type="button"
            class="group flex items-center gap-1 max-w-full text-base font-bold text-slate-900 rounded-md px-1 -mx-1 hover:bg-slate-100 transition-colors"
            title="가족 이름 수정"
            @click="startEditName"
          >
            <span class="truncate">{{ familyName }}</span>
            <svg
              class="w-3 h-3 flex-shrink-0 text-slate-300 group-hover:text-brand-600 transition-colors"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
            ><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
        </div>
        <!-- 데스크톱 접기/펼치기 토글 -->
        <button
          type="button"
          class="hidden md:inline-flex ml-auto items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors collapse-toggle"
          :title="sidebarCollapsed ? '사이드바 펼치기' : '사이드바 접기'"
          :aria-label="sidebarCollapsed ? '사이드바 펼치기' : '사이드바 접기'"
          @click="toggleCollapsed"
        >
          <svg v-if="!sidebarCollapsed" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 19l-7-7 7-7"/><path d="M19 19l-7-7 7-7"/></svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 5l7 7-7 7"/><path d="M5 5l7 7-7 7"/></svg>
        </button>
      </div>

      <!-- 가족 구성원 -->
      <div class="px-3 mb-2 collapsible-section">
        <div class="px-2 mb-1.5 flex items-center justify-between">
          <span class="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">가족 · 활성 합산</span>
          <div class="flex items-center gap-1.5">
            <button
              type="button"
              class="text-[10px] text-slate-500 hover:text-slate-800"
              title="모든 가족 합산"
              @click="activateAll"
            >전체</button>
            <NuxtLink to="/family" class="text-[10px] text-brand-600 hover:text-brand-700">관리</NuxtLink>
          </div>
        </div>
        <ul class="space-y-0.5">
          <li v-for="m in members" :key="m.id">
            <div
              :class="[
                'family-item',
                isActive(m.id) ? 'family-item-active' : '',
                primaryMemberId === m.id ? 'family-item-primary' : ''
              ]"
            >
              <input
                type="checkbox"
                :checked="isActive(m.id)"
                :title="isActive(m.id) ? '선택 해제 (합산/업로드 대상에서 제외)' : '선택 (합산/업로드 대상에 포함)'"
                @change="toggleActive(m.id)"
                class="family-check"
              />
              <button
                type="button"
                class="family-name-btn"
                :title="`주 멤버(업로드 저장 대상)로 설정 (현재: ${m.role})`"
                @click="setPrimary(m.id)"
              >
                <span
                  class="family-avatar"
                  :style="{ background: m.color, color: '#fff' }"
                >{{ m.emoji || '👤' }}</span>
                <span class="flex-1 truncate text-left">{{ m.name }}</span>
                <span v-if="primaryMemberId === m.id" class="primary-badge">주</span>
                <span v-else class="text-[10px] text-slate-400">{{ m.role }}</span>
              </button>
            </div>
          </li>
        </ul>
        <NuxtLink
          to="/family"
          class="mt-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md border border-dashed border-slate-300 text-[11px] text-slate-500 hover:bg-slate-50 hover:text-slate-700"
        >+ 가족 추가</NuxtLink>
        <p class="mt-1 px-2 text-[10px] text-slate-400 leading-tight">
          체크된 가족의 데이터가 합산되어 표시됩니다.
          <template v-if="members.length > 0 && !members.some((m) => isActive(m.id))">
            <br /><span class="text-amber-600">선택된 가족이 없어 업로드가 비활성화됩니다.</span>
          </template>
        </p>
      </div>

      <!-- 콤팩트 모드 전용: 가족 멤버 색상 점만 표시 -->
      <div class="collapsed-only px-2 mb-2" :title="`가족: ${familyName}`">
        <div class="flex flex-wrap justify-center gap-1">
          <span
            v-for="m in members.slice(0, 4)"
            :key="m.id"
            class="w-5 h-5 rounded-full grid place-items-center text-[10px] font-medium text-white"
            :style="{ background: m.color, opacity: isActive(m.id) ? 1 : 0.35 }"
            :title="`${m.name} · ${m.role}${isActive(m.id) ? ' (활성)' : ''}`"
          >{{ m.emoji || (m.name?.[0] ?? '·') }}</span>
        </div>
      </div>

      <!-- 메뉴 -->
      <nav class="px-3 flex-1 overflow-y-auto">
        <NuxtLink to="/" :class="navItem" exact-active-class="bg-brand-50 text-brand-700 font-semibold" title="대시보드">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0"><path d="M3 9.5L12 3l9 6.5"/><path d="M5 10v10h14V10"/></svg>
          <span class="collapsible-text">대시보드</span>
        </NuxtLink>

        <NuxtLink to="/income-expense" :class="navItem" active-class="bg-brand-50 text-brand-700 font-semibold" title="수입/지출">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8"/><path d="M12 6v2M12 16v2"/></svg>
          <span class="collapsible-text">수입/지출</span>
        </NuxtLink>

        <span :class="navItemDisabled" title="통계 (준비 중)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>
          <span class="collapsible-text">통계</span>
        </span>

        <!-- 자산 (그룹) -->
        <div class="mt-2">
          <div class="flex items-center gap-3 px-3 py-2 text-sm text-brand-700 font-semibold" title="자산">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0"><path d="M3 9.5L12 3l9 6.5V21H3z"/><path d="M9 21V12h6v9"/></svg>
            <span class="collapsible-text">자산</span>
          </div>
          <div class="ml-7 mt-1 space-y-0.5 collapsible-section">
            <NuxtLink to="/assets" :class="navSub" active-class="bg-brand-50 text-brand-700 font-semibold">자산 현황</NuxtLink>
            <NuxtLink to="/savings" :class="navSub" active-class="bg-brand-50 text-brand-700 font-semibold">예금/적금</NuxtLink>
            <NuxtLink to="/loans" :class="navSub" active-class="bg-brand-50 text-brand-700 font-semibold">대출</NuxtLink>
            <NuxtLink to="/cards" :class="navSub" active-class="bg-brand-50 text-brand-700 font-semibold">카드</NuxtLink>
          </div>
        </div>

        <!-- 일정 (그룹) — 자산 그룹과 같은 구조/스타일 -->
        <div class="mt-2">
          <div class="flex items-center gap-3 px-3 py-2 text-sm text-brand-700 font-semibold" title="일정">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0"><rect x="3" y="4" width="18" height="17" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>
            <span class="collapsible-text">일정</span>
          </div>
          <div class="ml-7 mt-1 space-y-0.5 collapsible-section">
            <NuxtLink to="/contracts" :class="navSub" active-class="bg-brand-50 text-brand-700 font-semibold">계약 관리</NuxtLink>
            <NuxtLink to="/anniversaries" :class="navSub" active-class="bg-brand-50 text-brand-700 font-semibold">기념일 관리</NuxtLink>
          </div>
        </div>

        <span :class="[navItemDisabled, 'mt-2']" title="예산 (준비 중)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span class="collapsible-text">예산</span>
        </span>

        <span :class="navItemDisabled" title="보고서 (준비 중)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>
          <span class="collapsible-text">보고서</span>
        </span>

        <NuxtLink to="/settings" :class="navItem" active-class="bg-brand-50 text-brand-700 font-semibold" title="설정">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.31.07.62.21.91.42l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82z"/></svg>
          <span class="collapsible-text">설정</span>
        </NuxtLink>
      </nav>

      <!-- 이번 달 요약 -->
      <div class="m-3 p-3 rounded-xl bg-slate-50 border border-slate-200 collapsible-section">
        <div class="text-xs font-semibold text-slate-700">이번 달 요약</div>
        <div class="text-[10px] text-slate-400 tabular-nums mb-2">{{ monthRangeLabel }}</div>
        <dl class="space-y-1 text-xs">
          <div class="flex items-center justify-between">
            <dt class="text-slate-500">총 수입</dt>
            <dd class="text-blue-600 font-medium tabular-nums">{{ fmt(stats.income) }}</dd>
          </div>
          <div class="flex items-center justify-between">
            <dt class="text-slate-500">총 지출</dt>
            <dd class="text-rose-600 font-medium tabular-nums">{{ fmt(stats.expense) }}</dd>
          </div>
          <div class="flex items-center justify-between pt-1 border-t border-slate-200">
            <dt class="text-slate-700 font-semibold">순수익</dt>
            <dd :class="['font-bold tabular-nums', stats.net >= 0 ? 'text-emerald-600' : 'text-rose-600']">{{ fmt(stats.net) }}</dd>
          </div>
        </dl>
      </div>
    </aside>

    <!-- 모바일 오버레이 -->
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 bg-slate-900/30 z-20 md:hidden"
      @click="sidebarOpen = false"
    ></div>

    <!-- 본문 -->
    <main class="flex-1 min-w-0">
      <!-- 모바일 햄버거 -->
      <button
        type="button"
        class="md:hidden m-3 p-2 rounded-md border border-slate-300 bg-white text-slate-700"
        aria-label="메뉴 열기"
        @click="sidebarOpen = !sidebarOpen"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      <slot />
      <footer class="px-fluid-6 pb-6 pt-2 text-xs text-slate-400 flex justify-between flex-wrap gap-2">
        <span>© {{ new Date().getFullYear() }} 가계부 대시보드</span>
        <span>파일은 브라우저에서만 처리되며 서버로 전송되지 않습니다.</span>
      </footer>
    </main>
  </div>
</template>

<style scoped>
/* ─────────────────────────────────────────
 * 사이드바 베이스
 * 모바일: 절대 위치 슬라이드 / 데스크톱: sticky + 폭 트랜지션
 * ───────────────────────────────────────── */
.sidebar-base {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 30;
  width: 15rem;
  background: #fff;
  border-right: 1px solid rgb(226 232 240);
  display: flex;
  flex-direction: column;
  transform: translateX(-100%);
  transition: transform 0.18s ease, width 0.18s ease;
}
.sidebar-base.is-open { transform: translateX(0); }
@media (min-width: 768px) {
  .sidebar-base {
    position: sticky;
    top: 0;
    height: 100vh;
    transform: none;
  }
  /* 데스크톱 콤팩트: 폭만 줄이고 sticky 유지 */
  .sidebar-base.sidebar-collapsed { width: 4rem; }
}

/* 콤팩트 모드 — 텍스트 라벨/요약 숨기고 아이콘만 */
@media (min-width: 768px) {
  .sidebar-collapsed .collapsible-text,
  .sidebar-collapsed .collapsible-section {
    display: none;
  }
  .sidebar-collapsed nav a,
  .sidebar-collapsed nav span {
    justify-content: center;
    padding-inline: 0.5rem;
  }
  .sidebar-collapsed nav .ml-7 {
    margin-left: 0;
  }
}

/* 콤팩트 전용 — 기본은 숨김, 데스크톱 콤팩트일 때만 표시 */
.collapsed-only { display: none; }
@media (min-width: 768px) {
  .sidebar-collapsed .collapsed-only { display: block; }
}

/* 콤팩트 모드 토글 버튼 — 콤팩트 시 가운데로 (헤더 자체가 줄어듦) */
.sidebar-collapsed .collapse-toggle {
  margin-left: 0;
}

/* ─────────────────────────────────────────
 * 가족 멤버 아이템 — 기존 스타일 유지
 * ───────────────────────────────────────── */
.family-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 6px;
  border-radius: 8px;
  background: transparent;
  border: 1px solid transparent;
  color: rgb(71 85 105);
  font-size: 13px;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.family-item:hover {
  background: rgb(248 250 252);
  border-color: rgb(226 232 240);
}
.family-item-active {
  background: rgb(239 246 255);
  border-color: rgb(191 219 254);
  color: rgb(29 78 216);
}
.family-item-primary {
  background: rgb(219 234 254);
  border-color: rgb(147 197 253);
  color: rgb(30 64 175);
  font-weight: 600;
}
.family-check {
  flex-shrink: 0;
  margin: 0;
  cursor: pointer;
  accent-color: rgb(37 99 235);
}
.family-check:disabled { cursor: not-allowed; }
.family-name-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font-size: inherit;
  font-weight: inherit;
  cursor: pointer;
}
.family-avatar {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 9999px;
  display: grid;
  place-items: center;
  font-size: 12px;
  line-height: 1;
}
.primary-badge {
  display: inline-block;
  padding: 1px 5px;
  font-size: 9px;
  border-radius: 6px;
  background: rgb(37 99 235);
  color: #fff;
  font-weight: 700;
  letter-spacing: 0.5px;
}
</style>
