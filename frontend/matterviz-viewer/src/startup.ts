export type ReadyFetch = (
  input: URL,
  init: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>

export const signal_frontend_ready = async (
  page: URL = new URL(window.location.href),
  request: ReadyFetch = (input, init) => fetch(input, init),
): Promise<boolean> => {
  const capability = page.searchParams.get('cap')
  if (!capability) return false

  const endpoint = new URL('/api/ready', page)
  endpoint.searchParams.set('cap', capability)
  const response = await request(endpoint, { method: 'POST', cache: 'no-store' })
  if (!response.ok) throw new Error(`MatterViz readiness request returned HTTP ${response.status}`)
  const payload = await response.json() as { ok?: unknown }
  if (payload.ok !== true) throw new Error('MatterViz readiness request was rejected')
  return true
}
