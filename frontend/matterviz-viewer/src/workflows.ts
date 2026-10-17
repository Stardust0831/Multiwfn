import type { BuilderCatalog, BuilderDraft, BuilderPreview } from './workflow-builder'
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
  state: 'running' | 'cancelling' | 'cancelled' | 'prepared' | 'completed' | 'failed' | 'interrupted'
  exitCode: number | null
  message: string
  log: string
  files: string[]
  cubes?: WorkflowCube[]
}
export type WorkflowScope = { batch: string; item: string; attempt?: number }
export type WorkflowTraceNode = { index: number; state: string; phase: string; failedPhase: string; start: number | null; end: number | null; started: number | null; finished: number | null; output: {file:string;start:number;end:number|null} | null }
export type WorkflowTraceGroup = { id: string; file: string; combination: number; combinations: number; variables: Record<string,string>; nodes: WorkflowTraceNode[] }
export type WorkflowTrace = { available: boolean; steps: Array<{label:string;kind:string;sections:string[];origin:string;command?:string}>; groups: WorkflowTraceGroup[]; truncated: boolean }
export type WorkflowStepLog = { file:string; text:string; truncated:boolean; start:number; end:number; step:number; group:string; source:'driver'|'multiwfn' }
export type BatchRoot = { path: string; patterns: string[]; recursive: boolean }
export type BatchInputSet = { files: string[]; roots: BatchRoot[]; explicitFiles?: string[]; excluded?: string[] }
export type BatchPlan = { version: number; combinations: number; inputs: Array<{ path: string; name: string; bindings: Record<string,string>; errors: string[] }> }
export type BatchCase = { id: string; name: string; path: string; state: string; attempts: number; started: number | null; finished: number | null; message: string | null }
export type BatchStatus = { id: string; directory: string; state: string; script: string; combinations: number; created: number; message: string; counts: Record<string,number>; cases: BatchCase[] }
export type BatchDetail = { job: WorkflowJob; item: { id: string; name: string; path: string; attempt: number; attempts: number } }
export const batch_active = (batch: BatchStatus | null | undefined): boolean => !!batch && ['running','pausing','paused','cancelling'].includes(batch.state)
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
  batch?: BatchStatus | null
  inputSet?: BatchInputSet
}
export type WorkflowSelection = 'library' | 'results' | 'wavefunction' | 'script'
export type WorkflowRequest = { script: string; cores: number; variables: string[]; dryRun: boolean; parameters?: Record<string, string>; bindings?: Record<string, string> }
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
const JOB_STATES = ['running', 'cancelling', 'cancelled', 'prepared', 'completed', 'failed', 'interrupted']

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
    batchPlan: async (body: unknown): Promise<BatchPlan> => call('batch-plan',body) as Promise<BatchPlan>,
    batchPick: async (kind: 'files'|'folder'): Promise<string[]|null> => (await call('batch-pick',{kind}) as {paths:string[]|null}).paths,
    batchSelect: async (set: BatchInputSet): Promise<WorkflowStatus> => parse_workflow_status(await call('batch-select',set)),
    batchStart: async (body: WorkflowRequest): Promise<WorkflowStatus> => parse_workflow_status(await call('batch-start',body)),
    batchControl: async (batch: string, action: string, item?: string): Promise<WorkflowStatus> => parse_workflow_status(await call('batch-control',{batch,action,...(item?{item}:{})})),
    batchLoad: async (): Promise<WorkflowStatus> => parse_workflow_status(await call('batch-load',{})),
    batchDetail: async (scope: WorkflowScope): Promise<BatchDetail> => call('batch-detail',scope) as Promise<BatchDetail>,
    trace: async (directory: string, scope?: WorkflowScope): Promise<WorkflowTrace> => call('trace',{directory,...scope}) as Promise<WorkflowTrace>,
    stepLog: async (directory:string, group:string, step:number, source:'driver'|'multiwfn', scope?:WorkflowScope):Promise<WorkflowStepLog> => call('trace',{directory,group,step,source,...scope}) as Promise<WorkflowStepLog>,
    builderCatalog: async (): Promise<BuilderCatalog> => {
      const value = await call('builder-catalog') as BuilderCatalog
      if (value.version !== 1 || !Array.isArray(value.modules)) throw new Error('Invalid conf catalog')
      return value
    },
    builderPreview: async (draft: BuilderDraft): Promise<BuilderPreview> => call('builder-preview', draft) as Promise<BuilderPreview>,
    builderSave: async (draft: BuilderDraft): Promise<WorkflowStatus | null> => {
      const value = await call('builder-save', draft) as { saved: boolean; status?: unknown }
      return value.saved ? parse_workflow_status(value.status) : null
    },
    openPath: async (directory: string, file?: string, scope?: Partial<WorkflowScope>): Promise<void> => { await call('open-path', { directory, ...(file === undefined ? {} : { file }), ...scope }) },
    openResults: async (directory: string, files: string[], units: Record<string, string>, scope?: WorkflowScope): Promise<void> => { await call('open-result', { directory, files, units, ...scope }) },
    openResult: async (directory: string, file: string, unit?: string, scope?: WorkflowScope): Promise<void> => { await call('open-result', { directory, file, unit, ...scope }) },
    status: async () => parse_workflow_status(await call('status')),
    pick: async (kind: WorkflowSelection) => parse_workflow_status(await call('pick', { kind })),
    cancel: async () => parse_workflow_status(await call('cancel', {})),
    run: async (body: WorkflowRequest) => parse_workflow_status(await call('run', body)),
    inspect: async (script: string, parameters: Record<string, string>, variables: string[] = [], wavefunction?: string): Promise<WorkflowInspection> => {
      const value = await call('inspect', { script, parameters, variables, ...(wavefunction?{wavefunction}:{}) }) as WorkflowInspection
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
