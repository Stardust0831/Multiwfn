export type FrequencyDownload = (data: Blob | string, filename: string, mime: string) => Promise<void>
type SaveFetch = (url: URL, init: RequestInit) => Promise<Response>
export const FREQUENCY_EXPORT_LIMIT = 64 * 1024 * 1024

/** An instance-scoped byte sink. The native host alone chooses a destination path. */
export function create_frequency_save(page: URL, request: SaveFetch = (url, init) => fetch(url, init), signal?: AbortSignal): FrequencyDownload {
  return async (data, filename, mime) => {
    const capability = page.searchParams.get('cap')
    if (!capability) throw new Error('Saving requires the native host. Open this viewer from BaneWfn.')
    signal?.throwIfAborted()
    const body = typeof data === 'string' ? new Blob([data], { type: mime }) : data
    if (!body.size || body.size > FREQUENCY_EXPORT_LIMIT) throw new Error('Export must be nonempty and at most 64 MiB.')
    const endpoint = new URL('/api/viewer-export', page)
    endpoint.searchParams.set('cap', capability)
    endpoint.searchParams.set('filename', filename)
    const response = await request(endpoint, { method: 'POST', headers: { 'Content-Type': mime }, body, signal })
    const text = await response.text()
    let result: { status?: string; message?: string }
    try { result = JSON.parse(text) }
    catch { throw new Error(response.ok ? 'Native host returned an invalid save result.' : text || 'Unable to save this export.') }
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Native host returned an invalid save result.')
    if (!response.ok) throw new Error(result.message || 'Unable to save this export.')
    if (result.status === 'cancelled') throw new DOMException('Save cancelled.', 'AbortError')
    if (result.status !== 'saved') throw new Error('Native host returned an invalid save result.')
    signal?.throwIfAborted()
  }
}
