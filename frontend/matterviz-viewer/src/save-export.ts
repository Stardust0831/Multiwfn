declare global {
  interface Window { __MULTIWFN_NATIVE_EXPORT__?: boolean }
}

export type SaveOutcome = 'saved' | 'cancelled' | 'downloaded'

export const download_blob = async (blob: Blob, filename: string): Promise<SaveOutcome> => {
  filename = filename.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
  if (window.__MULTIWFN_NATIVE_EXPORT__) {
    const page = new URL(window.location.href)
    const endpoint = new URL('/api/viewer-export', page)
    endpoint.searchParams.set('cap', page.searchParams.get('cap') ?? '')
    endpoint.searchParams.set('filename', filename)
    const response = await fetch(endpoint, { method: 'POST', body: blob })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || 'Could not save export')
    if (result.status !== 'saved' && result.status !== 'cancelled') throw new Error('Invalid save response')
    return result.status
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
  return 'downloaded'
}
