<script setup lang="ts">
// 내 지역화폐 관리 (설정 > 지역화폐 탭).
//
// 지역화폐·상품권·선불카드·포인트를 '소비 카테고리'가 아니라 **선불 자산**으로 관리한다.
// - 자산 추가/수정/활성 토글/할인율/기초잔액
// - 충전(할인 반영)·잔액 조정 → 원장. 사용 내역은 거래내역의 '지역화폐 사용' 체크에서 파생된다
// - 카드(결제수단) 연결: 한 자산에 여러 카드, 한 카드에 여러 자산
// 잔액은 저장값이 아니라 파생값이라 거래를 고치거나 지우면 자동으로 맞는다.
import { computed, reactive, ref } from 'vue'
import { useLocalCurrency, PREPAID_PRESETS } from '~/composables/useLocalCurrency'
import { useTaxonomies } from '~/composables/useTaxonomies'
import { formatKRW, todayYmd } from '~/utils/format'
import { PREPAID_KINDS, paidFromValue, valueFromPaid, type PrepaidKind } from '~/utils/localCurrency'

const {
  assets, summaryOf, historyOf, totals, rechargeByPayment,
  addAsset, updateAsset, setActive, removeAsset, isLinked, setLink,
  addRecharge, addAdjustment, removeLedgerEntry
} = useLocalCurrency()
const { visiblePaymentNames } = useTaxonomies()

const emit = defineEmits<{ (e: 'notify', kind: 'ok' | 'err', msg: string): void }>()
const notify = (kind: 'ok' | 'err', msg: string) => emit('notify', kind, msg)

const fmt = (n: number) => formatKRW(n)
const signed = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + formatKRW(Math.abs(n))
const kindLabel = (k: PrepaidKind) => PREPAID_KINDS.find((x) => x.value === k)?.label ?? '기타'

// ── 추가 폼 ──
const newName = ref('')
const newKind = ref<PrepaidKind>('LOCAL_CURRENCY')
const newRate = ref<number>(10)
const newOpening = ref<number>(0)
const newPresetId = ref<string | undefined>(undefined)
const addError = ref('')

function pickPreset(id: string) {
  const p = PREPAID_PRESETS.find((x) => x.id === id)
  if (!p) return
  newName.value = p.name
  newKind.value = p.kind
  newRate.value = p.discountRate
  newPresetId.value = p.id
  addError.value = ''
}
function onAdd() {
  const r = addAsset({
    id: newPresetId.value, name: newName.value, kind: newKind.value,
    discountRate: newRate.value, openingBalance: newOpening.value
  })
  if (!r.ok) { addError.value = r.reason; return notify('err', r.reason) }
  notify('ok', `추가됨: ${newName.value.trim()}`)
  newName.value = ''; newOpening.value = 0; newPresetId.value = undefined; addError.value = ''
}
const presetTaken = (id: string) => assets.value.some((a) => a.id === id)

// ── 자산 편집 ──
function onField(id: string, field: 'name' | 'discountRate' | 'openingBalance' | 'kind', value: string | number) {
  const r = updateAsset(id, { [field]: value } as never)
  if (!r.ok) notify('err', r.reason)
}
function onToggleActive(id: string, name: string, v: boolean) {
  setActive(id, v)
  notify('ok', v ? `${name} 사용 켬 — 연결된 카드 거래에 체크박스가 표시됩니다` : `${name} 사용 끔 — 새로 체크할 수 없고, 기존 사용 내역·잔액은 유지됩니다`)
}
function onRemove(id: string, name: string) {
  if (!window.confirm(`'${name}'을(를) 삭제할까요?\n충전·조정 내역도 함께 삭제됩니다.`)) return
  const r = removeAsset(id)
  notify(r.ok ? 'ok' : 'err', r.ok ? `삭제됨: ${name}` : r.reason)
}
function onToggleLink(id: string, payment: string, linked: boolean) {
  setLink(id, payment, linked)
}

// ── 충전 / 조정 폼 (한 번에 하나만 펼친다) ──
type Panel = { id: string; mode: 'recharge' | 'adjust' | 'history' } | null
const panel = ref<Panel>(null)
const openPanel = (id: string, mode: 'recharge' | 'adjust' | 'history') => {
  panel.value = panel.value?.id === id && panel.value.mode === mode ? null : { id, mode }
  if (panel.value && mode !== 'history') resetForm(id)
}
const isOpen = (id: string, mode: string) => panel.value?.id === id && panel.value.mode === mode

const form = reactive({ date: todayYmd(), value: 0, paid: 0, paymentMethod: '', memo: '', delta: 0 })
function resetForm(id: string) {
  const a = assets.value.find((x) => x.id === id)
  form.date = todayYmd(); form.value = 0; form.paid = 0; form.memo = ''; form.delta = 0
  form.paymentMethod = a?.linkedPayments[0] ?? ''
}
/** 액면 입력 → 실결제액을 할인율로 자동 계산 (실결제액은 직접 고쳐도 된다) */
function onValueInput(rate: number) { form.paid = paidFromValue(form.value, rate) }
/** 실결제액 입력 → 액면을 할인율로 역산 */
function onPaidInput(rate: number) { form.value = valueFromPaid(form.paid, rate) }

function submitRecharge(id: string, name: string) {
  const r = addRecharge(id, { date: form.date, value: form.value, paid: form.paid, paymentMethod: form.paymentMethod, memo: form.memo })
  if (!r.ok) return notify('err', r.reason)
  notify('ok', `${name} 충전 ${fmt(form.value)} (결제 ${fmt(form.paid)}) 기록됨`)
  panel.value = null
}
function submitAdjust(id: string, name: string) {
  const r = addAdjustment(id, { date: form.date, delta: form.delta, memo: form.memo })
  if (!r.ok) return notify('err', r.reason)
  notify('ok', `${name} 잔액 조정 ${signed(form.delta)} 기록됨`)
  panel.value = null
}
function onRemoveEntry(id: string, entryId: string) {
  if (!window.confirm('이 내역을 삭제할까요? 잔액이 다시 계산됩니다.')) return
  const r = removeLedgerEntry(id, entryId)
  notify(r.ok ? 'ok' : 'err', r.ok ? '내역 삭제됨' : r.reason)
}

// ── 가시성 헬퍼: 잔액 게이지 / 상태 ──
// 게이지 = 현재 잔액 ÷ (기초 + 충전 + 조정). 쓴 만큼 줄어드는 '남은 비율'이다.
const LOW_PCT = 20
function poolOf(id: string): number {
  const a = assets.value.find((x) => x.id === id)
  const s = summaryOf(id)
  return (a?.openingBalance ?? 0) + s.totalRecharge + s.totalAdjust
}
function pctOf(id: string): number {
  const pool = poolOf(id)
  if (pool <= 0) return 0
  return Math.max(0, Math.min(100, (summaryOf(id).balance / pool) * 100))
}
type Level = 'neg' | 'low' | 'ok' | 'empty'
function levelOf(id: string): Level {
  const b = summaryOf(id).balance
  if (b < 0) return 'neg'
  if (poolOf(id) <= 0) return 'empty'
  return pctOf(id) <= LOW_PCT ? 'low' : 'ok'
}
const LEVEL_LABEL: Record<Level, string> = { neg: '잔액 초과 사용', low: '잔액 부족', ok: '', empty: '' }
const activeCount = computed(() => assets.value.filter((a) => a.active).length)

const KIND_LABEL: Record<string, string> = { RECHARGE: '충전', USAGE: '사용', ADJUST: '조정' }
const rechargeFlows = computed(() => Array.from(rechargeByPayment.value.entries()))
</script>

<template>
  <section class="card lc">
    <!-- 요약: 소비 통계와 자금 흐름을 분리해서 보여준다 -->
    <header class="lc-sum">
      <div class="lc-kpi lc-kpi-main">
        <span class="lc-kpi-label">전체 잔액</span>
        <span :class="['lc-kpi-big', totals.balance < 0 ? 'neg' : '']">{{ fmt(totals.balance) }}</span>
        <span class="lc-kpi-sub">등록 {{ assets.length }}개 · 사용 중 {{ activeCount }}개</span>
      </div>
      <div class="lc-kpi">
        <span class="lc-kpi-label">누적 충전 (액면)</span>
        <span class="lc-kpi-val in">+{{ fmt(totals.recharge) }}</span>
        <span class="lc-kpi-sub">실결제 {{ fmt(totals.paid) }}</span>
      </div>
      <div class="lc-kpi">
        <span class="lc-kpi-label">할인 혜택</span>
        <span class="lc-kpi-val gain">{{ fmt(totals.benefit) }}</span>
        <span class="lc-kpi-sub">액면 − 실결제</span>
      </div>
      <div class="lc-kpi">
        <span class="lc-kpi-label">누적 사용</span>
        <span class="lc-kpi-val out">−{{ fmt(totals.usage) }}</span>
        <span class="lc-kpi-sub">거래내역 체크 기준</span>
      </div>
    </header>
    <p class="lc-note">
      <span class="lc-note-item"><b>충전</b> 소비가 아니라 자산 이동입니다. 카드 충전 결제 건은 '충전' 유형 카테고리로 분류해 소비에서 빼 주세요.</span>
      <span class="lc-note-item"><b>사용</b> 거래내역에서 연결된 카드 거래의 '지역화폐 사용'을 체크하면 잔액이 차감되고, 그 거래는 <b>지출 계산에서 제외</b>됩니다 (해제하면 되돌아옵니다).</span>
    </p>

    <!-- 추가 -->
    <div class="lc-add">
      <div class="lc-presets">
        <span class="lc-hint">빠른 추가</span>
        <button
          v-for="p in PREPAID_PRESETS" :key="p.id" type="button" class="lc-chip"
          :disabled="presetTaken(p.id)" :title="presetTaken(p.id) ? '이미 등록됨' : `${p.name} · 할인율 ${p.discountRate}%`"
          @click="pickPreset(p.id)"
        >{{ p.name }}</button>
      </div>
      <div class="lc-add-row">
        <select v-model="newKind" class="lc-input lc-w-sm" aria-label="종류" @change="newPresetId = undefined">
          <option v-for="k in PREPAID_KINDS" :key="k.value" :value="k.value">{{ k.label }}</option>
        </select>
        <input v-model="newName" type="text" maxlength="20" placeholder="이름 (예: 서울페이)" class="lc-input lc-grow"
               @input="newPresetId = undefined; addError = ''" @keydown.enter="onAdd" />
        <label class="lc-field"><span>할인율</span><input v-model.number="newRate" type="number" min="0" max="100" step="0.5" class="lc-input lc-w-xs" /><em>%</em></label>
        <label class="lc-field"><span>현재 잔액</span><input v-model.number="newOpening" type="number" step="1000" class="lc-input lc-w-md" /><em>원</em></label>
        <button type="button" class="btn-primary" @click="onAdd">추가</button>
      </div>
      <div v-if="addError" class="lc-err" role="alert">{{ addError }}</div>
    </div>

    <!-- 자금 흐름 -->
    <div v-if="rechargeFlows.length > 0" class="lc-flow">
      <div class="lc-flow-title">자금 흐름 (카드 → 선불 자산)</div>
      <ul>
        <li v-for="[pm, f] in rechargeFlows" :key="pm">
          <span class="lc-flow-from">{{ pm }}</span>
          <span class="out">−{{ fmt(f.paid) }}</span>
          <span class="arrow">→</span>
          <span class="in">+{{ fmt(f.value) }}</span>
          <span v-if="f.value > f.paid" class="gain">할인 {{ fmt(f.value - f.paid) }}</span>
        </li>
      </ul>
    </div>

    <!-- 목록 -->
    <div v-if="assets.length === 0" class="lc-empty">등록된 지역화폐가 없습니다. 위에서 추가해 보세요.</div>

    <article v-for="a in assets" :key="a.id" :class="['lc-item', a.active ? '' : 'is-off']">
      <div class="lc-item-head">
        <div class="lc-title">
          <input
            :value="a.name" type="text" maxlength="20" class="lc-name" :aria-label="`${a.name} 이름`"
            @change="onField(a.id, 'name', ($event.target as HTMLInputElement).value)"
          />
          <span class="lc-kind">{{ kindLabel(a.kind) }}</span>
          <span v-if="!a.active" class="lc-state off">꺼짐</span>
          <span v-else-if="LEVEL_LABEL[levelOf(a.id)]" :class="['lc-state', levelOf(a.id)]">{{ LEVEL_LABEL[levelOf(a.id)] }}</span>
          <code class="lc-code" title="거래에 저장되는 코드">{{ a.id }}</code>
        </div>
        <label class="lc-switch" :title="a.active ? '사용 중 — 연결된 카드 거래에 체크박스 표시' : '사용 안 함 — 새 체크 불가 (기존 내역·잔액 유지)'">
          <input type="checkbox" :checked="a.active" @change="onToggleActive(a.id, a.name, ($event.target as HTMLInputElement).checked)" />
          <span class="track"></span>
          <span class="lbl">{{ a.active ? '사용' : '꺼짐' }}</span>
        </label>
      </div>

      <div class="lc-balance">
        <div class="lc-balance-top">
          <span :class="['lc-balance-num', summaryOf(a.id).balance < 0 ? 'neg' : '']">{{ fmt(summaryOf(a.id).balance) }}</span>
          <span class="lc-balance-pct">
            <template v-if="poolOf(a.id) > 0">남은 비율 {{ Math.round(pctOf(a.id)) }}%</template>
            <template v-else>충전·기초 잔액 없음</template>
          </span>
        </div>
        <div
          class="lc-gauge" role="progressbar" aria-label="잔액 비율"
          :aria-valuenow="Math.round(pctOf(a.id))" aria-valuemin="0" aria-valuemax="100"
          :title="`충전·기초·조정 합계 ${fmt(poolOf(a.id))} 중 ${fmt(summaryOf(a.id).balance)} 남음`"
        >
          <span :class="['lc-gauge-fill', levelOf(a.id)]" :style="{ width: pctOf(a.id) + '%' }"></span>
        </div>
        <div class="lc-balance-scale"><span>사용 {{ fmt(summaryOf(a.id).totalUsage) }}</span><span>총 {{ fmt(poolOf(a.id)) }}</span></div>
      </div>

      <dl class="lc-stats">
        <div><dt>누적 충전</dt><dd class="in">{{ fmt(summaryOf(a.id).totalRecharge) }}</dd></div>
        <div><dt>누적 사용</dt><dd class="out">{{ fmt(summaryOf(a.id).totalUsage) }} <small>({{ summaryOf(a.id).usageCount }}건)</small></dd></div>
        <div><dt>할인율</dt><dd>{{ a.discountRate }}%</dd></div>
        <div><dt>연결 카드</dt><dd>{{ a.linkedPayments.length }}개</dd></div>
      </dl>

      <div class="lc-sec-title">기본 설정</div>
      <div class="lc-edit">
        <label class="lc-field"><span>종류</span>
          <select :value="a.kind" class="lc-input lc-w-sm" @change="onField(a.id, 'kind', ($event.target as HTMLSelectElement).value)">
            <option v-for="k in PREPAID_KINDS" :key="k.value" :value="k.value">{{ k.label }}</option>
          </select>
        </label>
        <label class="lc-field"><span>할인율</span>
          <input :value="a.discountRate" type="number" min="0" max="100" step="0.5" class="lc-input lc-w-xs"
                 @change="onField(a.id, 'discountRate', Number(($event.target as HTMLInputElement).value))" /><em>%</em>
        </label>
        <label class="lc-field" title="이 앱에 등록하기 전부터 있던 잔액 — 충전·사용은 여기에 더하고 뺍니다">
          <span>기초 잔액</span>
          <input :value="a.openingBalance" type="number" step="1000" class="lc-input lc-w-md"
                 @change="onField(a.id, 'openingBalance', Number(($event.target as HTMLInputElement).value))" /><em>원</em>
        </label>
      </div>

      <!-- 카드 연결 -->
      <div class="lc-links">
        <span class="lc-sec-title lc-sec-inline">연결된 카드 <em>{{ a.linkedPayments.length }}</em></span>
        <label
          v-for="p in visiblePaymentNames" :key="`${a.id}-${p}`"
          :class="['lc-link', isLinked(a.id, p) ? 'on' : '']"
        >
          <input type="checkbox" :checked="isLinked(a.id, p)" @change="onToggleLink(a.id, p, ($event.target as HTMLInputElement).checked)" />
          {{ p }}
        </label>
        <span v-if="a.linkedPayments.length === 0" class="lc-warn-hint">카드를 연결해야 그 카드 거래에 '지역화폐 사용' 체크가 나타납니다</span>
      </div>

      <div class="lc-actions">
        <button type="button" class="lc-btn" @click="openPanel(a.id, 'recharge')">충전 추가</button>
        <button type="button" class="lc-btn" @click="openPanel(a.id, 'adjust')">잔액 조정</button>
        <button type="button" class="lc-btn" @click="openPanel(a.id, 'history')">충전·사용 내역 {{ isOpen(a.id, 'history') ? '접기' : '보기' }}</button>
        <button type="button" class="lc-btn danger" @click="onRemove(a.id, a.name)">삭제</button>
      </div>

      <!-- 충전 -->
      <form v-if="isOpen(a.id, 'recharge')" class="lc-form" @submit.prevent="submitRecharge(a.id, a.name)">
        <label class="lc-field"><span>날짜</span><input v-model="form.date" type="date" class="lc-input" required /></label>
        <label class="lc-field"><span>충전액 (액면)</span>
          <input v-model.number="form.value" type="number" min="1" step="1000" class="lc-input lc-w-md" required @input="onValueInput(a.discountRate)" /><em>원</em>
        </label>
        <label class="lc-field"><span>실결제액</span>
          <input v-model.number="form.paid" type="number" min="0" step="1000" class="lc-input lc-w-md" @input="onPaidInput(a.discountRate)" /><em>원</em>
        </label>
        <label class="lc-field"><span>결제수단</span>
          <select v-model="form.paymentMethod" class="lc-input">
            <option value="">(미지정)</option>
            <option v-for="p in visiblePaymentNames" :key="p" :value="p">{{ p }}</option>
          </select>
        </label>
        <label class="lc-field lc-grow"><span>메모</span><input v-model="form.memo" type="text" maxlength="40" class="lc-input" placeholder="선택" /></label>
        <button type="submit" class="btn-primary">충전 기록</button>
        <p class="lc-form-hint">
          할인율 {{ a.discountRate }}% 기준: 결제 {{ fmt(form.paid) }} → 잔액 +{{ fmt(form.value) }}
          <template v-if="form.value > form.paid">(혜택 {{ fmt(form.value - form.paid) }})</template>
          · 소비로 집계되지 않습니다.
        </p>
      </form>

      <!-- 조정 -->
      <form v-if="isOpen(a.id, 'adjust')" class="lc-form" @submit.prevent="submitAdjust(a.id, a.name)">
        <label class="lc-field"><span>날짜</span><input v-model="form.date" type="date" class="lc-input" required /></label>
        <label class="lc-field"><span>증감액</span>
          <input v-model.number="form.delta" type="number" step="100" class="lc-input lc-w-md" required /><em>원</em>
        </label>
        <label class="lc-field lc-grow"><span>사유</span><input v-model="form.memo" type="text" maxlength="40" class="lc-input" placeholder="예: 잔액 실사 차이, 소멸" /></label>
        <button type="submit" class="btn-primary">조정 기록</button>
        <p class="lc-form-hint">+는 잔액 증가, −는 감소입니다. 실제 앱 잔액과 맞출 때 쓰세요.</p>
      </form>

      <!-- 내역 -->
      <div v-if="isOpen(a.id, 'history')" class="lc-history">
        <table>
          <thead><tr><th>날짜</th><th>구분</th><th>내용</th><th class="r">증감</th><th class="r">잔액</th><th></th></tr></thead>
          <tbody>
            <tr v-if="a.openingBalance !== 0">
              <td>—</td><td><span class="tag">기초</span></td><td>기초 잔액</td><td class="r">{{ signed(a.openingBalance) }}</td><td class="r">{{ fmt(a.openingBalance) }}</td><td></td>
            </tr>
            <tr v-for="r in historyOf(a.id)" :key="r.key">
              <td>{{ r.date }}</td>
              <td><span :class="['tag', r.kind.toLowerCase()]">{{ KIND_LABEL[r.kind] }}</span></td>
              <td>
                {{ r.label }}
                <small v-if="r.kind === 'RECHARGE' && r.paid !== undefined"> · 결제 {{ fmt(r.paid) }}<template v-if="r.payment"> ({{ r.payment }})</template></small>
                <small v-else-if="r.payment"> · {{ r.payment }}</small>
              </td>
              <td :class="['r', r.delta < 0 ? 'neg' : 'pos']">{{ signed(r.delta) }}</td>
              <td class="r">{{ fmt(r.balanceAfter) }}</td>
              <td class="r">
                <button v-if="r.kind !== 'USAGE'" type="button" class="lc-x" title="삭제" @click="onRemoveEntry(a.id, r.refId)">✕</button>
                <span v-else class="lc-hint" title="거래내역에서 '지역화폐 사용' 체크를 해제하면 사라집니다">거래</span>
              </td>
            </tr>
            <tr v-if="historyOf(a.id).length === 0"><td colspan="6" class="empty">내역이 없습니다.</td></tr>
          </tbody>
        </table>
      </div>
    </article>
  </section>
</template>

<style scoped>
.lc { padding: 16px; }
.lc-sum { display: grid; grid-template-columns: 1.4fr repeat(3, 1fr); gap: 10px; }
.lc-kpi { display: flex; flex-direction: column; gap: 3px; padding: 12px 14px; border: 1px solid #e1e6ee; border-radius: 12px; background: #fff; min-width: 0; }
.lc-kpi-main { background: #eaf1fd; border-color: #c7d8f7; }
.lc-kpi-label { font-size: 12px; font-weight: 600; color: #566074; }
.lc-kpi-big { font-size: 28px; font-weight: 800; line-height: 1.1; letter-spacing: -.5px; color: #123a8a; font-variant-numeric: tabular-nums; }
.lc-kpi-big.neg { color: #dc2626; }
.lc-kpi-val { font-size: 18px; font-weight: 800; color: #141a24; font-variant-numeric: tabular-nums; }
.lc-kpi-val.in, .lc-kpi-val.gain { color: #0d9488; } .lc-kpi-val.out { color: #b45309; }
.lc-kpi-sub { font-size: 11px; color: #8993a6; }
@media (max-width: 900px) { .lc-sum { grid-template-columns: 1fr 1fr; } .lc-kpi-main { grid-column: 1 / -1; } }
.lc-note { margin: 12px 0 0; padding: 10px 12px; font-size: 12px; line-height: 1.6; color: #3b4658; background: #f6f8fc; border-radius: 8px; display: flex; flex-direction: column; gap: 4px; }
.lc-note-item b { margin-right: 6px; padding: 0 6px; border-radius: 4px; background: #e8effc; color: #123a8a; }

.lc-add { margin-top: 16px; display: flex; flex-direction: column; gap: 8px; }
.lc-presets { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.lc-hint { font-size: 11px; color: #8993a6; }
.lc-chip { height: 26px; padding: 0 10px; font-size: 12px; border-radius: 999px; border: 1px solid #c9cfdb; background: #fff; color: #1f2937; cursor: pointer; }
.lc-chip:hover:not(:disabled) { background: #eef3fd; border-color: #1b55c9; }
.lc-chip:disabled { opacity: .4; cursor: not-allowed; }
.lc-add-row, .lc-form, .lc-edit { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px 10px; }
.lc-add-row { align-items: center; }
.lc-err { font-size: 12px; color: #dc2626; }
.lc-input { height: 32px; padding: 0 8px; font-size: 13px; border: 1px solid #c9cfdb; border-radius: 6px; background: #fff; color: #1f2937; min-width: 0; }
.lc-input:focus { outline: 2px solid #1b55c9; outline-offset: -1px; border-color: #1b55c9; }
.lc-grow { flex: 1; min-width: 9rem; }
.lc-w-xs { width: 64px; } .lc-w-sm { width: 104px; } .lc-w-md { width: 124px; }
.lc-field { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #566074; }
.lc-form .lc-field, .lc-edit .lc-field { flex-direction: column; align-items: flex-start; gap: 3px; }
.lc-form .lc-field em, .lc-edit .lc-field em { display: none; }
.lc-field em { font-style: normal; color: #8993a6; }
.lc-form-hint { flex-basis: 100%; margin: 0; font-size: 12px; color: #566074; }

.lc-flow { margin-top: 16px; padding: 10px 12px; border: 1px solid #e1e6ee; border-radius: 10px; }
.lc-flow-title { font-size: 12px; font-weight: 700; color: #3b4658; margin-bottom: 6px; }
.lc-flow ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.lc-flow li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; font-size: 13px; font-variant-numeric: tabular-nums; }
.lc-flow-from { min-width: 96px; font-weight: 600; color: #1f2937; }
.lc-flow .out { color: #dc2626; } .lc-flow .in { color: #0d9488; font-weight: 600; } .lc-flow .arrow { color: #8993a6; }
.lc-flow .gain { font-size: 11px; color: #0d9488; background: #e6f6f3; padding: 1px 8px; border-radius: 999px; }

.lc-empty { margin-top: 20px; padding: 28px 12px; text-align: center; font-size: 13px; color: #8993a6; background: #f8fafc; border-radius: 10px; }
.lc-item { margin-top: 14px; padding: 14px; border: 1px solid #e1e6ee; border-radius: 12px; background: #fff; }
.lc-item.is-off { background: #f8fafc; }
.lc-item.is-off .lc-stats, .lc-item.is-off .lc-title, .lc-item.is-off .lc-balance { opacity: .55; }
.lc-state { font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 999px; }
.lc-state.off { background: #e5e7eb; color: #4b5563; }
.lc-state.low { background: #fef3c7; color: #92400e; }
.lc-state.neg { background: #fee2e2; color: #b91c1c; }

.lc-balance { margin-top: 12px; padding: 12px 14px; border-radius: 10px; background: #f6f8fc; }
.lc-balance-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.lc-balance-num { font-size: 24px; font-weight: 800; letter-spacing: -.4px; color: #141a24; font-variant-numeric: tabular-nums; }
.lc-balance-num.neg { color: #dc2626; }
.lc-balance-pct { font-size: 12px; font-weight: 600; color: #566074; }
.lc-gauge { height: 10px; margin-top: 8px; border-radius: 999px; background: #dfe5ef; overflow: hidden; }
.lc-gauge-fill { display: block; height: 100%; border-radius: 999px; background: #1b55c9; transition: width .25s; }
.lc-gauge-fill.low { background: #d97706; }
.lc-gauge-fill.neg, .lc-gauge-fill.empty { background: #dc2626; }
.lc-balance-scale { display: flex; justify-content: space-between; margin-top: 4px; font-size: 11px; color: #8993a6; font-variant-numeric: tabular-nums; }
.lc-sec-title { margin-top: 14px; font-size: 12px; font-weight: 700; color: #3b4658; }
.lc-sec-title em { font-style: normal; margin-left: 4px; padding: 0 7px; border-radius: 999px; background: #e8effc; color: #123a8a; font-size: 11px; }
.lc-sec-inline { margin-top: 0; margin-right: 4px; }
.lc-warn-hint { font-size: 12px; color: #92400e; background: #fef3c7; padding: 3px 10px; border-radius: 999px; }
.lc-item-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.lc-title { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
.lc-name { font-size: 16px; font-weight: 700; color: #141a24; border: 1px solid transparent; border-radius: 6px; padding: 2px 6px; background: transparent; width: 11rem; max-width: 100%; }
.lc-name:hover, .lc-name:focus { border-color: #c9cfdb; background: #fff; outline: none; }
.lc-kind { font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 999px; background: #e8effc; color: #123a8a; }
.lc-code { font-size: 10px; color: #8993a6; }

.lc-switch { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px; color: #3b4658; }
.lc-switch input { position: absolute; opacity: 0; pointer-events: none; }
.lc-switch .track { position: relative; width: 34px; height: 20px; border-radius: 999px; background: #c9cfdb; transition: background .15s; }
.lc-switch .track::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .15s; }
.lc-switch input:checked + .track { background: #1b55c9; }
.lc-switch input:checked + .track::after { transform: translateX(14px); }
.lc-switch input:focus-visible + .track { outline: 2px solid #1b55c9; outline-offset: 2px; }

.lc-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin: 12px 0 0; }
.lc-stats > div { padding: 8px 10px; background: #f6f8fc; border-radius: 8px; }
.lc-stats dt { font-size: 11px; color: #566074; }
.lc-stats dd { margin: 2px 0 0; font-size: 15px; font-weight: 700; color: #141a24; font-variant-numeric: tabular-nums; }
.lc-stats dd small { font-size: 11px; font-weight: 500; color: #8993a6; }
.lc-stats dd.in { color: #0d9488; } .lc-stats dd.out { color: #b45309; }
.lc-edit { margin-top: 6px; }

.lc-links { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 14px; padding-top: 12px; border-top: 1px dashed #e1e6ee; }
.lc-link { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px; font-size: 12px; border: 1px solid #c9cfdb; border-radius: 999px; background: #fff; color: #3b4658; cursor: pointer; user-select: none; }
.lc-link input { accent-color: #1b55c9; }
.lc-link.on { background: #eaf1fd; border-color: #1b55c9; color: #123a8a; font-weight: 600; }

.lc-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; padding-top: 12px; border-top: 1px dashed #e1e6ee; }
.lc-btn { height: 30px; padding: 0 12px; font-size: 12px; border-radius: 6px; border: 1px solid #c9cfdb; background: #fff; color: #1f2937; cursor: pointer; }
.lc-btn:hover { background: #f3f5f9; }
.lc-btn.danger { margin-left: auto; color: #dc2626; border-color: #f3b4b6; }
.lc-btn.danger:hover { background: #dc2626; color: #fff; border-color: #dc2626; }
.lc-form { margin-top: 12px; padding: 12px; background: #f6f8fc; border-radius: 10px; }

.lc-history { margin-top: 12px; overflow-x: auto; }
.lc-history table { width: 100%; font-size: 12px; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.lc-history th { text-align: left; font-weight: 600; color: #566074; padding: 6px 8px; border-bottom: 1px solid #e1e6ee; white-space: nowrap; }
.lc-history td { padding: 6px 8px; border-bottom: 1px solid #f0f2f7; }
.lc-history .r { text-align: right; white-space: nowrap; }
.lc-history .pos { color: #0d9488; } .lc-history .neg { color: #dc2626; }
.lc-history .empty { text-align: center; color: #8993a6; padding: 14px; }
.lc-history small { color: #8993a6; }
.tag { font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 999px; background: #eef1f6; color: #566074; }
.tag.recharge { background: #e6f6f3; color: #0d9488; }
.tag.usage { background: #fef3c7; color: #92400e; }
.tag.adjust { background: #ede9fe; color: #6d28d9; }
.lc-x { border: 0; background: transparent; color: #8993a6; cursor: pointer; font-size: 12px; padding: 2px 6px; }
.lc-x:hover { color: #dc2626; }
@media (max-width: 720px) { .lc-btn.danger { margin-left: 0; } }
</style>
