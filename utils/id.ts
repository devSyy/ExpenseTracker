// ID 생성 유틸 — 로컬 저장소용 충돌 방지 ID (암호학적 용도 아님)

export function createId(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-6)
}
