<script setup lang="ts">
// 한 명의 가족 구성원에 대한 업로드 → 파싱/검증 → 미리보기 → 저장/리셋 패널.
// 임시 상태는 useMemberUploads()가 멤버별로 독립 보관하므로,
// 대상 멤버를 바꿔도 다른 멤버의 업로드 내용은 유지된다.
import { computed } from 'vue'
import { useMemberUploads } from '~/composables/useMemberUploads'
import { useExpenses } from '~/composables/useExpenses'
import { useFamily } from '~/composables/useFamily'

const props = defineProps<{ memberId: string }>()

const { uploadOf, handleFile, loadSample, save, reset, ACCEPT_ATTR } = useMemberUploads()
const { countOfMember, memberMeta } = useExpenses()
const { members } = useFamily()

const upload = computed(() => uploadOf(props.memberId))
const member = computed(() => members.value.find((m) => m.id === props.memberId) ?? null)

/** 이 멤버에게 이미 저장되어 있는 거래 수 */
const savedCount = computed(() => countOfMember(props.memberId))
const savedMeta = computed(() => memberMeta(props.memberId))

async function onFile(file: File) {
  await handleFile(props.memberId, file)
}

function onSave() {
  save(props.memberId)
}

function onReset() {
  reset(props.memberId)
}

const canSave = computed(() => upload.value.status === 'ready' && upload.value.transactions.length > 0)
const canReset = computed(() => upload.value.status !== 'idle')

function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
</script>

<template>
  <div class="space-y-3">
    <!-- 대상 멤버 안내 -->
    <div class="flex items-center justify-between gap-2 flex-wrap text-sm">
      <div class="flex items-center gap-2 min-w-0">
        <span
          class="w-6 h-6 rounded-full grid place-items-center text-xs text-white flex-shrink-0"
          :style="{ background: member?.color || '#94a3b8' }"
        >{{ member?.emoji || '👤' }}</span>
        <span class="text-slate-700">
          업로드 대상: <b class="text-slate-900">{{ member?.name || '알 수 없음' }}</b>
        </span>
        <span class="text-xs text-slate-400 tabular-nums">
          (저장됨 {{ savedCount.toLocaleString('ko-KR') }}건<template v-if="savedMeta"> · {{ fmtTime(savedMeta.savedAt) }}</template>)
        </span>
      </div>
      <button
        type="button"
        class="text-xs text-brand-700 hover:text-brand-800 font-medium whitespace-nowrap"
        @click="loadSample(props.memberId)"
      >
        샘플 데이터 불러오기 →
      </button>
    </div>

    <!-- 업로드 영역 -->
    <ExcelUploader
      :accept="ACCEPT_ATTR"
      :busy="upload.status === 'parsing'"
      @file="onFile"
    />

    <!-- 미리보기 / 검증 결과 -->
    <ExcelPreview
      v-if="upload.status !== 'idle'"
      :upload="upload"
      :member-name="member?.name || ''"
    />

    <!-- 저장 옵션 + 액션 -->
    <div
      v-if="upload.status !== 'idle'"
      class="flex items-center justify-between gap-3 flex-wrap"
    >
      <div class="flex items-center gap-3 text-xs text-slate-600">
        <label class="inline-flex items-center gap-1.5 cursor-pointer">
          <input type="radio" value="replace" v-model="upload.saveMode" class="accent-brand-600" />
          <span>교체 저장<span v-if="savedCount > 0" class="text-slate-400"> (기존 {{ savedCount.toLocaleString('ko-KR') }}건 대체)</span></span>
        </label>
        <label class="inline-flex items-center gap-1.5 cursor-pointer">
          <input type="radio" value="append" v-model="upload.saveMode" class="accent-brand-600" />
          <span>추가 저장 <span class="text-slate-400">(중복 제외)</span></span>
        </label>
      </div>

      <div class="flex items-center gap-2">
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canReset"
          title="이 가족의 임시 업로드 내용만 비웁니다. 저장된 데이터는 삭제되지 않습니다."
          @click="onReset"
        >
          초기화
        </button>
        <button
          type="button"
          class="px-4 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canSave"
          :title="`${member?.name ?? ''} 의 가계부로 저장합니다.`"
          @click="onSave"
        >
          저장하기
        </button>
      </div>
    </div>

    <!-- 저장 결과 메시지 -->
    <p
      v-if="upload.message"
      :class="[
        'text-sm rounded-md px-3 py-2',
        upload.status === 'saved' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
      ]"
    >
      {{ upload.message }}
    </p>

    <p v-if="upload.status === 'ready'" class="text-[11px] text-slate-400">
      업로드만으로는 저장되지 않습니다. <b>저장하기</b>를 눌러야 {{ member?.name }} 의 가계부에 반영됩니다.
    </p>
  </div>
</template>
