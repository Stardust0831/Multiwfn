export type UpdateState = 'idle' | 'checking' | 'available' | 'staging' | 'ready' | 'conflict' | 'installing' | 'error' | 'recovery'

export type UpdateStatus = {
  visible: boolean
  state: UpdateState
  currentTag?: string
  targetTag?: string
  progress?: number
  conflicts: string[]
  message?: string
}

export type UpdateFetch = (input: URL, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>

const FORMAT = 'multiwfn-matterviz-update'
const VERSION = 1
const STATES: readonly UpdateState[] = ['idle', 'checking', 'available', 'staging', 'ready', 'conflict', 'installing', 'error', 'recovery']
const ACTIVE_STATES: readonly UpdateState[] = ['checking', 'staging', 'installing']
const MAX_MESSAGE = 512
const MAX_CONFLICTS = 32
const MAX_CONFLICT = 256

const plain_text = (value: unknown, limit: number): string | undefined => {
  if (typeof value !== 'string') return undefined
  const text = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
  return text || undefined
}

const tag = (value: unknown): string | undefined => {
  const text = plain_text(value, 128)
  return text && /^[A-Za-z0-9][A-Za-z0-9._+/-]{0,127}$/.test(text) ? text : undefined
}

const finite_progress = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(100, Math.max(0, value))
}

export const is_update_active = (state: UpdateState): boolean => ACTIVE_STATES.includes(state)

export const sanitize_update_text = (value: unknown): string => plain_text(value, MAX_MESSAGE) ?? ''

export const parse_update_status = (value: unknown): UpdateStatus => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid update status')
  const item = value as Record<string, unknown>
  if (item.format !== FORMAT || item.version !== VERSION) throw new Error('Unsupported update status')
  if (typeof item.visible !== 'boolean') throw new Error('Invalid update visibility')
  if (typeof item.state !== 'string' || !STATES.includes(item.state as UpdateState)) throw new Error('Invalid update state')
  if (item.conflicts !== undefined && !Array.isArray(item.conflicts)) throw new Error('Invalid update conflicts')
  const conflicts = Array.isArray(item.conflicts)
    ? item.conflicts.slice(0, MAX_CONFLICTS).map((entry) => plain_text(entry, MAX_CONFLICT)).filter((entry): entry is string => Boolean(entry))
    : []
  const result: UpdateStatus = {
    visible: item.visible,
    state: item.state as UpdateState,
    conflicts,
    currentTag: tag(item.currentTag ?? item.current_tag ?? item.current),
    targetTag: tag(item.targetTag ?? item.target_tag ?? item.target),
    progress: finite_progress(item.progress),
    message: plain_text(item.message, MAX_MESSAGE),
  }
  if (result.state === 'conflict' && result.conflicts.length === 0 && !result.message) result.message = 'The update could not be staged because local files changed.'
  return result
}

export const update_endpoint = (page: URL, action: 'status' | 'check' | 'stage' | 'install'): URL => {
  const endpoint = new URL(`/api/update/${action}`, page)
  const capability = page.searchParams.get('cap')
  if (capability) endpoint.searchParams.set('cap', capability)
  return endpoint
}

export const create_update_client = (
  page: URL = new URL(window.location.href),
  request: UpdateFetch = (input, init) => fetch(input, init),
) => {
  const status = async (): Promise<UpdateStatus> => {
    const response = await request(update_endpoint(page, 'status'), { cache: 'no-store' })
    if (!response.ok) throw new Error(`Update status returned HTTP ${response.status}`)
    return parse_update_status(await response.json())
  }
  const post = async (action: 'check' | 'stage' | 'install'): Promise<UpdateStatus> => {
    const response = await request(update_endpoint(page, action), {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (!response.ok) throw new Error(`Update ${action} returned HTTP ${response.status}`)
    return parse_update_status(await response.json())
  }
  return { status, check: () => post('check'), stage: () => post('stage'), install: () => post('install') }
}

export type UpdatePollOptions = {
  client: Pick<ReturnType<typeof create_update_client>, 'status'>
  initial: UpdateStatus
  onStatus: (status: UpdateStatus) => void
  onError: (error: unknown) => void
  intervalMs?: number
  timer?: { setTimeout: (callback: () => void, delay: number) => unknown; clearTimeout: (id: unknown) => void }
}

export const poll_update_status = (options: UpdatePollOptions): (() => void) => {
  const interval = Math.max(500, options.intervalMs ?? 500)
  const timer = options.timer ?? {
    setTimeout: (callback: () => void, delay: number): unknown => globalThis.setTimeout(callback, delay),
    clearTimeout: (id: unknown): void => globalThis.clearTimeout(id as number),
  }
  let cancelled = false
  let pending: unknown
  const run = async (): Promise<void> => {
    if (cancelled) return
    try {
      const status = await options.client.status()
      if (cancelled) return
      options.onStatus(status)
      if (is_update_active(status.state)) pending = timer.setTimeout(() => void run(), interval)
    } catch (error) {
      if (!cancelled) options.onError(error)
    }
  }
  if (is_update_active(options.initial.state)) pending = timer.setTimeout(() => void run(), interval)
  return () => {
    cancelled = true
    if (pending !== undefined) timer.clearTimeout(pending)
  }
}
