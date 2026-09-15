<script setup lang="ts">
// 업로드된(아직 저장되지 않은) 파일의 상태/검증 결과/미리보기.
import { computed } from 'vue'
import { formatDate, formatKRW } from '~/utils/format'
import type { MemberUpload } from '~/composables/useMemberUploads'

const props = withDefaults(
  defineProps<{
    upload: MemberUpload
    /** 미리보기에 표시할 최대 행 수 */
    limit?: number
    /** 대상 멤버 표시명 */
    memberName?: string
  }>(),
  { limit: 8, memberName: '' }
)

const rows = computed(() => props.upload.transactions.slice(0, props.limit))
const totalAmount = computed(() =>
  props.upload.transactions.reduce((s, t) => s + (Number(t.amount) || 0), 0)
)
const period = computed(() => {
  const txs = props.upload.transactions
  if (txs.length === 0) return ''
  const first = txs[0]?.date
  const last = txs[txs.length - 1]?.date
  if (!first || !last) return ''
  return `${formatDate(first)} ~ ${formatDate(last)}`
})

/** 파싱이 어떻게 이뤄졌는지 한 줄 요약 — 인식 실패 원인 파악에 필요하다. */
const parseInfo = computed(() => {
  const u = props.upload
  const parts: string[] = []
  if (u.sheetName) parts.push(`시트 "${u.sheetName}"`)
  if (u.headerRow) parts.push(`헤더 ${u.headerRow}행`)
  if (u.encoding) parts.push(u.encoding)
  const skip = u.skipped
  if (skip && (skip.noDate > 0 || skip.noAmount > 0)) {
    const s: string[] = []
    if (skip.noDate > 0) s.push(`날짜 해석 실패 ${skip.noDate}행`)
    if (skip.noAmount > 0) s.push(`금액 없음/0 ${skip.noAmount}행`)
    parts.push(`건너뜀: ${s.join(', ')}`)
  }
  return parts.join(' · ')
})

function sizeLabel(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}
</script>

<template>
  <div class="rounded-xl border border-slate-200 bg-white overflow-hidden">
    <!-- 헤더: 파일명 + 상태 -->
    <div class="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200 flex-wrap">
      <div class="flex items-center gap-2 min-w-0">
        <span class="text-base">📄</span>
        <span class="text-sm font-medium text-slate-800 truncate">{{ upload.fileName || '(파일 없음)' }}</span>
        <span v-if="upload.fileSize" class="text-[11px] text-slate-400 tabular-nums">{{ sizeLabel(upload.fileSize) }}</span>
      </div>
      <span
        :class="[
          'chip',
          upload.status === 'ready' ? 'bg-emerald-50 text-emerald-700'
          : upload.status === 'saved' ? 'bg-brand-50 text-brand-700'
          : upload.status === 'error' ? 'bg-red-50 text-red-700'
          : 'bg-slate-100 text-slate-500'
        ]"
      >
        {{
          upload.status === 'ready' ? '검증 통과 · 저장 대기'
          : upload.status === 'saved' ? '저장됨'
          : upload.status === 'parsing' ? '분석 중'
          : upload.status === 'error' ? '검증 실패'
          : '대기'
        }}
      </span>
    </div>

    <!-- 오류 -->
    <div v-if="upload.status === 'error'" class="px-3 py-2.5 bg-red-50">
      <p class="text-sm text-red-700">{{ upload.error }}</p>
      <p v-if="parseInfo" class="mt-1 text-[11px] text-red-500">{{ parseInfo }}</p>
    </div>

    <template v-else-if="upload.transactions.length > 0">
      <!-- 요약 -->
      <dl class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-200">
        <div class="bg-white px-3 py-2">
          <dt class="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">인식 행</dt>
          <dd class="text-sm font-bold text-slate-900 tabular-nums">
            {{ upload.transactions.length.toLocaleString('ko-KR') }}건
            <span v-if="upload.totalRows" class="text-[11px] font-normal text-slate-400">/ {{ upload.totalRows.toLocaleString('ko-KR') }}행</span>
          </dd>
        </div>
        <div class="bg-white px-3 py-2">
          <dt class="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">합계</dt>
          <dd class="text-sm font-bold text-slate-900 tabular-nums">{{ formatKRW(totalAmount) }}</dd>
        </div>
        <div class="bg-white px-3 py-2">
          <dt class="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">기간</dt>
          <dd class="text-sm font-medium text-slate-700 tabular-nums truncate">{{ period || '–' }}</dd>
        </div>
        <div class="bg-white px-3 py-2">
          <dt class="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">대상 가족</dt>
          <dd class="text-sm font-medium text-slate-700 truncate">{{ memberName || '–' }}</dd>
        </div>
      </dl>

      <!-- 파싱 정보 -->
      <p v-if="parseInfo" class="px-3 py-1.5 text-[11px] text-slate-400 border-t border-slate-100">
        {{ parseInfo }}
      </p>

      <!-- 경고 -->
      <ul
        v-if="upload.warnings.length > 0 || upload.duplicateInFile > 0"
        class="px-3 py-2 bg-amber-50 text-amber-800 text-xs space-y-0.5 border-t border-amber-100"
      >
        <li v-for="w in upload.warnings" :key="w">· {{ w }}</li>
        <li v-if="upload.duplicateInFile > 0">
          · 파일 안에 동일한 (날짜 · 내용 · 금액) 행이 {{ upload.duplicateInFile.toLocaleString('ko-KR') }}건 있습니다.
        </li>
      </ul>

      <!-- 미리보기 테이블 -->
      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead class="bg-slate-50 text-slate-500">
            <tr>
              <th class="text-left font-medium px-3 py-1.5 whitespace-nowrap">날짜</th>
              <th class="text-left font-medium px-3 py-1.5">내용</th>
              <th class="text-right font-medium px-3 py-1.5 whitespace-nowrap">금액</th>
              <th class="text-left font-medium px-3 py-1.5 whitespace-nowrap">카테고리</th>
              <th class="text-left font-medium px-3 py-1.5 whitespace-nowrap">결제수단</th>
              <th class="text-left font-medium px-3 py-1.5 whitespace-nowrap">구분</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="t in rows" :key="t.id">
              <td class="px-3 py-1.5 tabular-nums whitespace-nowrap text-slate-600">{{ formatDate(t.date) }}</td>
              <td class="px-3 py-1.5 text-slate-800 max-w-[16rem] truncate">{{ t.description }}</td>
              <td class="px-3 py-1.5 text-right tabular-nums text-slate-900">{{ formatKRW(t.amount) }}</td>
              <td class="px-3 py-1.5 text-slate-600 whitespace-nowrap">{{ t.category }}</td>
              <td class="px-3 py-1.5 text-slate-600 whitespace-nowrap">{{ t.paymentMethod }}</td>
              <td class="px-3 py-1.5 text-slate-600 whitespace-nowrap">{{ t.costType }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div
        v-if="upload.transactions.length > rows.length"
        class="px-3 py-1.5 text-[11px] text-slate-400 border-t border-slate-100"
      >
        … 외 {{ (upload.transactions.length - rows.length).toLocaleString('ko-KR') }}건 (저장하면 전체가 반영됩니다)
      </div>
    </template>
  </div>
</template>
