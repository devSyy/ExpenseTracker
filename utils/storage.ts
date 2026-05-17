// Storage 계층 — localStorage 직접 접근을 단일 어댑터 뒤로 추상화한다.
// 상위 계층(Repository)은 이 모듈만 사용하고, 컴포저블/UI는 Storage를 직접 만지지 않는다.
//
// SSR/비브라우저 환경에서는 인메모리 폴백을 제공해 안전하게 호출된다.

export interface StorageAdapter {
  get<T>(key: string, defaultValue: T, validator?: (x: unknown) => x is T): T
  /** 원시 객체를 반환 (검증 없음). null이면 default를 사용한다. */
  getRaw<T = unknown>(key: string): T | null
  set(key: string, value: unknown): boolean
  remove(key: string): void
  keys(prefix?: string): string[]
  has(key: string): boolean
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

class LocalStorageAdapter implements StorageAdapter {
  get<T>(key: string, defaultValue: T, validator?: (x: unknown) => x is T): T {
    try {
      const raw = localStorage.getItem(key)
      if (raw == null) return defaultValue
      const parsed = JSON.parse(raw)
      if (validator && !validator(parsed)) return defaultValue
      return parsed as T
    } catch {
      return defaultValue
    }
  }
  getRaw<T = unknown>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key)
      return raw == null ? null : (JSON.parse(raw) as T)
    } catch {
      return null
    }
  }
  set(key: string, value: unknown): boolean {
    try {
      localStorage.setItem(key, JSON.stringify(value))
      return true
    } catch {
      // QuotaExceeded 등은 호출자가 결정. 여기서는 false만 반환.
      return false
    }
  }
  remove(key: string): void {
    try { localStorage.removeItem(key) } catch { /* ignore */ }
  }
  keys(prefix?: string): string[] {
    const out: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k) continue
      if (!prefix || k.startsWith(prefix)) out.push(k)
    }
    return out
  }
  has(key: string): boolean {
    try { return localStorage.getItem(key) !== null } catch { return false }
  }
}

class MemoryStorageAdapter implements StorageAdapter {
  private store = new Map<string, string>()
  get<T>(key: string, defaultValue: T, validator?: (x: unknown) => x is T): T {
    const raw = this.store.get(key)
    if (raw == null) return defaultValue
    try {
      const parsed = JSON.parse(raw)
      if (validator && !validator(parsed)) return defaultValue
      return parsed as T
    } catch { return defaultValue }
  }
  getRaw<T = unknown>(key: string): T | null {
    const raw = this.store.get(key)
    if (raw == null) return null
    try { return JSON.parse(raw) as T } catch { return null }
  }
  set(key: string, value: unknown): boolean {
    try { this.store.set(key, JSON.stringify(value)); return true }
    catch { return false }
  }
  remove(key: string): void { this.store.delete(key) }
  keys(prefix?: string): string[] {
    const out: string[] = []
    for (const k of this.store.keys()) {
      if (!prefix || k.startsWith(prefix)) out.push(k)
    }
    return out
  }
  has(key: string): boolean { return this.store.has(key) }
}

export const storage: StorageAdapter = isBrowser()
  ? new LocalStorageAdapter()
  : new MemoryStorageAdapter()

/** 앱이 사용하는 모든 저장 키 (백업/복원 대상). 새 도메인 추가 시 여기에도 등록. */
export const APP_STORAGE_KEYS = [
  // taxonomies
  'expense:categories:v1',
  'expense:payments:v1',
  // dashboard transactions (excel-loaded)
  'expense:transactions:v1',
  'expense:txMeta:v1',
  // income/expense ledger
  'transactions:income-expense:v1',
  // assets
  'assets:state:v1',
  // loans
  'loans:state:v1',
  // savings
  'savings:info:v1',
  'savings:history:v1',
  // cards
  'cards:state:v1',
  // family
  'family:state:v1'
] as const
