// 브라우저 다운로드 헬퍼 — Blob을 만들고 <a download>로 저장시킨다. (클라이언트 전용)
export function downloadBytes(
  bytes: Uint8Array | ArrayBuffer,
  fileName: string,
  mimeType = 'application/octet-stream'
): void {
  const blob = new Blob([bytes as BlobPart], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** .xlsx MIME */
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
