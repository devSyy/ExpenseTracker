<script setup lang="ts">
// 엑셀 업로드 카드.
//
// 동작 규칙
//  - 사이드바에서 체크된 가족 = 활성 멤버. 활성 멤버가 없으면 업로드 영역 비활성화.
//  - 활성 멤버가 1명이면 그 멤버가 업로드 대상.
//  - 2명 이상이면 탭으로 대상 멤버를 고른다. 업로드 데이터는 "대상 멤버 1명"에게만 저장되며,
//    선택된 여러 멤버는 대시보드에서 합산 조회될 뿐 데이터가 복제되지 않는다.
//  - 멤버별 임시 업로드 상태는 서로 독립이며, 대상 탭을 바꿔도 유실되지 않는다.
import { computed, ref } from 'vue'
import { useFamily } from '~/composables/useFamily'
import { useMemberUploads } from '~/composables/useMemberUploads'
import { useTaxonomies } from '~/composables/useTaxonomies'
import { downloadSampleTemplate } from '~/utils/sampleTemplate'

const { activeMembers, hasActiveMember, uploadTargetMemberId, setUploadTarget } = useFamily()
const { uploadOf, ACCEPT_ATTR } = useMemberUploads()
const { visibleCategoryNames, visiblePaymentNames } = useTaxonomies()

const showTabs = computed(() => activeMembers.value.length > 1)

// 샘플 양식(.xlsx) 다운로드 — 등록된 카테고리/결제수단을 예시 값으로 채운다.
const sampleBusy = ref(false)
const sampleError = ref('')

async function onDownloadSample() {
  if (sampleBusy.value) return
  sampleBusy.value = true
  sampleError.value = ''
  try {
    await downloadSampleTemplate({
      categories: visibleCategoryNames.value,
      payments: visiblePaymentNames.value
    })
  } catch (e) {
    sampleError.value = `샘플 양식을 만들지 못했습니다: ${(e as Error).message}`
  } finally {
    sampleBusy.value = false
  }
}

/** 탭에 표시할 배지: 저장 대기 중인 임시 업로드가 있으면 표시 */
function badgeOf(memberId: string): string {
  const u = uploadOf(memberId)
  if (u.status === 'ready') return '●'
  if (u.status === 'error') return '!'
  return ''
}
</script>

<template>
  <section class="card">
    <!-- 좁은 화면에서는 헤더가 자연스럽게 두 줄로 줄바꿈되도록 flex-wrap -->
    <div class="flex items-start sm:items-center justify-between mb-4 flex-wrap gap-2">
      <div class="min-w-0">
        <h2 class="text-lg font-semibold text-slate-900">엑셀 파일 업로드</h2>
        <p class="text-sm text-slate-500 mt-0.5">
          .xlsx / .xls / .csv 형식의 가계부 파일을 올리면 자동으로 분류하고 시각화합니다.
        </p>
      </div>

      <div class="flex items-center gap-2 flex-wrap justify-end">
        <!-- 샘플 양식 다운로드 -->
        <button
          type="button"
          class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-brand-700 hover:border-brand-300 transition disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          :disabled="sampleBusy"
          title="업로드 형식에 맞춘 예시 엑셀 파일을 내려받습니다."
          @click="onDownloadSample"
        >
          <span aria-hidden="true">⬇</span>
          <span>{{ sampleBusy ? '만드는 중...' : '샘플 양식(.xlsx) 다운로드' }}</span>
        </button>

        <!-- 대상 멤버 탭 (활성 멤버 2명 이상일 때만) -->
        <div v-if="showTabs" class="flex items-center gap-1 flex-wrap">
          <span class="text-[11px] text-slate-400 mr-1">저장 대상</span>
          <button
            v-for="m in activeMembers"
            :key="m.id"
            type="button"
            :class="[
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition',
              uploadTargetMemberId === m.id
                ? 'bg-brand-50 border-brand-300 text-brand-700'
                : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
            ]"
            :title="`${m.name} 의 가계부로 저장`"
            @click="setUploadTarget(m.id)"
          >
            <span
              class="w-4 h-4 rounded-full grid place-items-center text-[9px] text-white"
              :style="{ background: m.color }"
            >{{ m.emoji || '👤' }}</span>
            <span>{{ m.name }}</span>
            <span
              v-if="badgeOf(m.id)"
              :class="['text-[9px]', badgeOf(m.id) === '!' ? 'text-red-500' : 'text-emerald-500']"
            >{{ badgeOf(m.id) }}</span>
          </button>
        </div>
      </div>
    </div>

    <p v-if="sampleError" class="mb-3 text-sm rounded-md bg-red-50 text-red-700 px-3 py-2">
      {{ sampleError }}
    </p>

    <!-- 활성 멤버 없음 → 업로드 비활성화 -->
    <template v-if="!hasActiveMember">
      <ExcelUploader :accept="ACCEPT_ATTR" disabled />
      <div class="mt-3 rounded-md bg-amber-50 text-amber-800 text-sm px-3 py-2">
        가족 구성원이 선택되지 않았습니다. 왼쪽 <b>가족 · 활성 합산</b> 목록에서 한 명 이상 체크하면
        엑셀 업로드를 사용할 수 있습니다.
      </div>
    </template>

    <!-- 대상 멤버 패널 -->
    <MemberUploadPanel v-else-if="uploadTargetMemberId" :member-id="uploadTargetMemberId" />

    <p v-if="showTabs" class="mt-3 text-[11px] text-slate-400 leading-relaxed">
      여러 명을 선택하면 대시보드는 선택된 가족의 데이터를 <b>합산</b>해서 보여줍니다.
      업로드한 파일은 위에서 고른 <b>저장 대상 1명</b>에게만 저장되며, 다른 가족의 데이터에는 영향을 주지 않습니다.
    </p>
  </section>
</template>
