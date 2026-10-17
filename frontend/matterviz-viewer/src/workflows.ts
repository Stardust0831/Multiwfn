export type WorkflowCube = {
  file: string
  kind: 'density' | 'esp' | 'elf' | 'lol' | 'hole' | 'electron' | 'orbital' | 'generic'
  unit: 'au' | 'kcal/mol' | null
  unitDeclared?: boolean
  orbital: string | null
  density?: string | null
}
export const workflow_cube_label = (cube: WorkflowCube): string => ({
  density: 'Electron density', esp: 'Electrostatic potential', elf: 'Electron localization function',
  lol: 'Localized orbital locator', hole: 'Hole density', electron: 'Electron distribution',
  orbital: cube.orbital || 'Orbital', generic: 'Cube volume',
})[cube.kind]

export type WorkflowJob = {
  directory: string
  state: 'running' | 'cancelling' | 'cancelled' | 'prepared' | 'completed' | 'failed'
  exitCode: number | null
  message: string
  log: string
  files: string[]
  cubes?: WorkflowCube[]
}
export type WorkflowStatus = {
  available: boolean
  runner: string | null
  library: string | null
  results: string | null
  wavefunction: string | null
  multiwfn: string | null
  scripts: Array<{ id: string; name: string }>
  selectedScript?: string | null
  selectionChanged?: boolean
  catalogError: string | null
  job: WorkflowJob | null
}
export type WorkflowSelection = 'library' | 'results' | 'wavefunction' | 'script'
export type WorkflowRequest = { script: string; cores: number; variables: string[]; dryRun: boolean; parameters?: Record<string, string> }
type WorkflowTranslations = Partial<Record<'zh' | 'en', string>>
export type WorkflowField = { id: string; name: string; group: string; label: string; labels?: WorkflowTranslations; type: string; value: string; expression?: string; source: string; help?: string; helps?: WorkflowTranslations; unit?: string; options: Array<{ value: string; label: string; labels?: WorkflowTranslations }> }
export type WorkflowInspection = { version: number; runnable: boolean; fields: WorkflowField[]; tasks: Array<{ task: number; module: string; commands: string }>; diagnostics: string[] }
export const display_path = (path: string | null | undefined): string => {
  if (!path) return ''
  if (path.startsWith('\\\\?\\UNC\\')) return '\\\\' + path.slice(8)
  if (/^\\\\\?\\[a-z]:\\/i.test(path)) return path.slice(4)
  return path
}
type WorkflowFetch = (url: URL, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>
const JOB_STATES = ['running', 'cancelling', 'cancelled', 'prepared', 'completed', 'failed']

export const workflow_active = (job: WorkflowJob | null): boolean =>
  job?.state === 'running' || job?.state === 'cancelling'

export const workflow_variables = (text: string): string[] => {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length > 64 || lines.some((line) => !line.includes('=') || line.length > 4096 || line.includes('\0'))) {
    throw new Error('Variables must use key=value, one per line')
  }
  return lines
}

export const parse_workflow_status = (value: unknown): WorkflowStatus => {
  if (!value || typeof value !== 'object') throw new Error('Invalid workflow status')
  const status = value as WorkflowStatus & { format: string; version: number }
  if (status.format !== 'multiwfn-workflows' || status.version !== 1 || typeof status.available !== 'boolean'
    || !Array.isArray(status.scripts) || status.scripts.length > 256
    || status.scripts.some((script) => typeof script.id !== 'string' || typeof script.name !== 'string')) {
    throw new Error('Invalid workflow status')
  }
  for (const key of ['runner', 'library', 'results', 'wavefunction', 'multiwfn', 'catalogError'] as const) {
    if (status[key] !== null && typeof status[key] !== 'string') throw new Error('Invalid workflow paths')
  }
  if (status.job !== null && (!status.job || !JOB_STATES.includes(status.job.state)
    || typeof status.job.directory !== 'string' || typeof status.job.log !== 'string'
    || typeof status.job.message !== 'string' || !Array.isArray(status.job.files)
    || status.job.files.some((file) => typeof file !== 'string')
    || (status.job.cubes !== undefined && (!Array.isArray(status.job.cubes) || status.job.cubes.some(cube =>
      !cube || typeof cube.file !== 'string' || !['density', 'esp', 'elf', 'lol', 'hole', 'electron', 'orbital', 'generic'].includes(cube.kind)
      || ![null, 'au', 'kcal/mol'].includes(cube.unit))))
    || (status.job.exitCode !== null && !Number.isInteger(status.job.exitCode)))) {
    throw new Error('Invalid workflow job')
  }
  return status
}

export const workflow_endpoint = (page: URL, action: string): URL => {
  const url = new URL(`/api/workflows/${action}`, page)
  const capability = page.searchParams.get('cap')
  if (capability) url.searchParams.set('cap', capability)
  return url
}

export const create_workflow_client = (
  page: URL = new URL(window.location.href),
  request: WorkflowFetch = (url, init) => fetch(url, init),
) => {
  const call = async (action: string, body?: unknown, script?: string): Promise<unknown> => {
    const url = workflow_endpoint(page, action)
    if (script !== undefined) url.searchParams.set('script', script)
    const response = await request(url, body === undefined ? { cache: 'no-store' } : {
      method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => undefined) as { message?: string } | undefined
      throw new Error(error?.message || `Workflow request returned HTTP ${response.status}`)
    }
    return response.json()
  }
  return {
    openPath: async (directory: string, file?: string): Promise<void> => { await call('open-path', { directory, ...(file === undefined ? {} : { file }) }) },
    openResults: async (directory: string, files: string[], units: Record<string, string>): Promise<void> => { await call('open-result', { directory, files, units }) },
    openResult: async (directory: string, file: string, unit?: string): Promise<void> => { await call('open-result', { directory, file, unit }) },
    status: async () => parse_workflow_status(await call('status')),
    pick: async (kind: WorkflowSelection) => parse_workflow_status(await call('pick', { kind })),
    cancel: async () => parse_workflow_status(await call('cancel', {})),
    run: async (body: WorkflowRequest) => parse_workflow_status(await call('run', body)),
    inspect: async (script: string, parameters: Record<string, string>, variables: string[] = []): Promise<WorkflowInspection> => {
      const value = await call('inspect', { script, parameters, variables }) as WorkflowInspection
      if (value.version !== 1 || !Array.isArray(value.fields) || !Array.isArray(value.tasks) || !Array.isArray(value.diagnostics)) throw new Error('Invalid parameter description')
      return value
    },
    parameterPath: async (type: string): Promise<string | null> => (await call('parameter-path', { type }) as { path: string | null }).path,
    preview: async (script: string): Promise<string> => {
      const value = await call('preview', undefined, script) as { id: string; source: string }
      if (value.id !== script || typeof value.source !== 'string' || value.source.length > 512 * 1024) {
        throw new Error('Invalid workflow preview')
      }
      return value.source
    },
  }
}
