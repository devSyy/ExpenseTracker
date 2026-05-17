// 백업 모듈 — 모든 도메인의 저장소 키를 단일 JSON으로 묶거나 풀어낸다.
// Storage 계층만 사용하고 도메인 로직에는 의존하지 않는다.
import { storage, APP_STORAGE_KEYS } from './storage'

export interface BackupPayload {
  version: number
  exportedAt: string
  app: 'expense-tracker'
  data: Record<string, unknown>
}

const CURRENT_VERSION = 1

/** 현재 저장소의 모든 앱 키를 묶어 백업 객체로 반환. */
export function exportAll(): BackupPayload {
  const data: Record<string, unknown> = {}
  for (const k of APP_STORAGE_KEYS) {
    const v = storage.getRaw(k)
    if (v != null) data[k] = v
  }
  return {
    version: CURRENT_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'expense-tracker',
    data
  }
}

/** 브라우저에 백업 JSON 파일을 다운로드 시킨다. */
export function downloadBackup(filename?: string): void {
  if (typeof document === 'undefined') return
  const payload = exportAll()
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  a.download = filename || `expense-tracker-backup-${stamp}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export type ImportStrategy = 'replace' | 'merge'

export interface ImportResult {
  ok: boolean
  imported: number
  skipped: number
  errors: string[]
}

/**
 * 백업 JSON을 저장소에 적용한다.
 * - replace(기본): 백업에 포함된 키를 그대로 덮어씀.
 * - merge: 객체/배열은 단순 덮어쓰지 않고 병합 (배열은 합쳐 dedup, 객체는 spread).
 *
 * 적용 후엔 페이지 새로고침 또는 각 리포지토리의 load() 호출이 필요하다.
 */
export function importFromJSON(json: string, strategy: ImportStrategy = 'replace'): ImportResult {
  const result: ImportResult = { ok: false, imported: 0, skipped: 0, errors: [] }
  let parsed: BackupPayload
  try {
    parsed = JSON.parse(json) as BackupPayload
  } catch (e) {
    result.errors.push(`JSON 파싱 실패: ${(e as Error).message}`)
    return result
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.data || typeof parsed.data !== 'object') {
    result.errors.push('잘못된 백업 형식 (data 필드 누락)')
    return result
  }
  if (parsed.app && parsed.app !== 'expense-tracker') {
    result.errors.push(`알 수 없는 앱 식별자: ${parsed.app}`)
    return result
  }

  for (const [key, value] of Object.entries(parsed.data)) {
    // 알 수 없는 키는 건너뜀 (안전)
    if (!(APP_STORAGE_KEYS as readonly string[]).includes(key)) {
      result.skipped++
      continue
    }
    if (strategy === 'replace') {
      const ok = storage.set(key, value)
      ok ? result.imported++ : result.errors.push(`저장 실패: ${key}`)
    } else {
      const existing = storage.getRaw(key)
      const merged = mergeValue(existing, value)
      const ok = storage.set(key, merged)
      ok ? result.imported++ : result.errors.push(`병합 저장 실패: ${key}`)
    }
  }
  result.ok = result.errors.length === 0
  return result
}

function mergeValue(existing: unknown, incoming: unknown): unknown {
  if (Array.isArray(existing) && Array.isArray(incoming)) {
    // id 또는 name 기반 dedup, 그 외엔 incoming을 우선
    const key = pickIdKey([...existing, ...incoming])
    if (!key) {
      // 단순 결합 후 JSON 문자열로 dedup
      const seen = new Set<string>()
      const out: unknown[] = []
      for (const item of [...existing, ...incoming]) {
        const sig = JSON.stringify(item)
        if (!seen.has(sig)) { seen.add(sig); out.push(item) }
      }
      return out
    }
    const map = new Map<string, unknown>()
    for (const item of existing as any[]) if (item && item[key] != null) map.set(String(item[key]), item)
    for (const item of incoming as any[]) if (item && item[key] != null) map.set(String(item[key]), item)
    return Array.from(map.values())
  }
  if (isPlainObject(existing) && isPlainObject(incoming)) {
    return { ...existing, ...incoming }
  }
  // 그 외엔 incoming으로 덮어씀
  return incoming
}

function pickIdKey(items: unknown[]): string | null {
  for (const candidate of ['id', 'name', 'ym', 'key']) {
    if (items.every((x) => x && typeof x === 'object' && (x as any)[candidate] != null)) {
      return candidate
    }
  }
  return null
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}
