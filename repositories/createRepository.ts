// 제네릭 리포지토리 팩토리.
//
// UI(컴포저블/페이지)는 storage를 직접 만지지 않고, 도메인별 Repository를 통해서만
// 데이터를 읽고 쓴다. Repository는 reactive한 state를 노출하고, 옵션에 따라
// 변경을 자동 영속화하거나(autoPersist:true) 명시적 save() 호출에서만 저장한다.
import { ref, watch, type Ref } from 'vue'
import { storage } from '~/utils/storage'

export interface RepositoryOptions<T> {
  /** localStorage 키 */
  key: string
  /** 비어있을 때/검증 실패 시 사용할 초기값 팩토리 */
  default: () => T
  /** 저장된 값의 형식 검증 (선택) */
  validator?: (x: unknown) => x is T
  /** 구버전 → 신버전 마이그레이션 (선택). raw가 검증을 통과하지 못해도 구조 변환에 사용. */
  migrate?: (raw: unknown) => T | null
  /**
   * true(기본): state 변경 시 자동으로 storage에 저장.
   * false: 명시적 save() 호출에서만 저장 (예: 엑셀 업로드처럼 명시 저장 UX).
   */
  autoPersist?: boolean
}

export interface Repository<T> {
  /** reactive 상태 — UI는 이것을 직접 구독하거나 바인딩한다. */
  readonly state: Ref<T>
  /** 저장소에서 다시 불러와 state에 반영. */
  load(): T
  /** 현재 state를 저장소에 저장. */
  save(): boolean
  /** 초기값으로 리셋 (저장소에도 반영됨, autoPersist에 따라). */
  reset(): void
  /** 저장소 키 — 백업 모듈이 키 목록을 수집할 때 사용. */
  readonly key: string
}

export function createRepository<T>(opts: RepositoryOptions<T>): Repository<T> {
  const initial = loadInitial(opts)
  const state = ref(initial) as Ref<T>

  if (opts.autoPersist !== false) {
    // 깊은 변경까지 추적해 자동 영속화
    watch(state, (v) => storage.set(opts.key, v), { deep: true })
  }

  function load(): T {
    const v = loadInitial(opts)
    state.value = v
    return v
  }

  function save(): boolean {
    return storage.set(opts.key, state.value)
  }

  function reset(): void {
    state.value = opts.default()
    if (opts.autoPersist === false) {
      // 자동 저장이 꺼진 경우, 리셋도 저장소에서 제거
      storage.remove(opts.key)
    }
  }

  return { state, load, save, reset, key: opts.key }
}

function loadInitial<T>(opts: RepositoryOptions<T>): T {
  // 키가 없으면 곧장 default
  if (!storage.has(opts.key)) return opts.default()

  // raw 파싱값을 한 번만 읽어두고 단계적으로 평가
  const raw = storage.getRaw(opts.key)
  if (raw == null) return opts.default()

  // 1) validator가 있고 통과하면 그대로 사용
  if (opts.validator && opts.validator(raw)) {
    return raw as T
  }

  // 2) migrate가 있으면 변환 시도 (validator가 없거나 검증에 실패한 경우)
  //    예: transactionsRepo는 PersistedShape{ transactions:[...] } → Transaction[]로 변환 필요
  if (opts.migrate) {
    const migrated = opts.migrate(raw)
    if (migrated != null) return migrated
  }

  // 3) validator도 migrate도 없으면 raw를 그대로 신뢰 (단순 객체 저장 패턴)
  if (!opts.validator && !opts.migrate) {
    return raw as T
  }

  // 4) 모두 실패 → default
  return opts.default()
}
