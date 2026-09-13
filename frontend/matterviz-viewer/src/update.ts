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
      if (!cancelled && is_update_active(status.state)) pending = timer.setTimeout(() => void run(), interval)
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

type UpdateClient = ReturnType<typeof create_update_client>
export type UpdateAction = 'check' | 'stage' | 'install'

type UpdateModalSessionOptions = {
  client: (signal: AbortSignal) => UpdateClient
  onStatus: (status: UpdateStatus) => void
  onBusy: (busy: boolean) => void
  onError: (error: unknown) => void
  timer?: UpdatePollOptions['timer']
}

// Closing the modal stops observing the updater; the backend operation continues.
// Each opening reads its current status before deciding whether to resume polling.
export const create_update_modal_session = (options: UpdateModalSessionOptions) => {
  let open = false
  let destroyed = false
  let busy = false
  let generation = 0
  let controller: AbortController | undefined
  let stop_poll: (() => void) | undefined

  const set_busy = (next: boolean): void => {
    busy = next
    options.onBusy(next)
  }

  const cancel = (): void => {
    generation += 1
    stop_poll?.()
    stop_poll = undefined
    controller?.abort()
    controller = undefined
  }

  const current = (request_generation: number): boolean =>
    open && !destroyed && request_generation === generation

  const request = async (action: UpdateAction | 'status'): Promise<void> => {
    cancel()
    const request_generation = generation
    controller = new AbortController()
    set_busy(true)
    try {
      const client = options.client(controller.signal)
      const next = await client[action]()
      if (!current(request_generation)) return
      options.onStatus(next)
      if (!current(request_generation)) return
      stop_poll = poll_update_status({
        client,
        initial: next,
        timer: options.timer,
        onStatus: (status) => { if (current(request_generation)) options.onStatus(status) },
        onError: (error) => { if (current(request_generation)) options.onError(error) },
      })
    } catch (error) {
      if (current(request_generation)) options.onError(error)
    } finally {
      if (current(request_generation)) set_busy(false)
    }
  }

  return {
    set_open: (next: boolean): void => {
      if (destroyed || next === open) return
      open = next
      if (open) void request('status')
      else {
        cancel()
        set_busy(false)
      }
    },
    run_action: async (action: UpdateAction): Promise<void> => {
      if (open && !destroyed && !busy) await request(action)
    },
    destroy: (): void => {
      destroyed = true
      open = false
      cancel()
    },
  }
}
