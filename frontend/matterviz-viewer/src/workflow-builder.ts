import type { WorkflowInspection } from './workflows'

export type BuilderProcess = { section: string; parameters: Record<string, string> }
export type BuilderCommand = { kind: 'rename'; source: string; target: string } | { kind: 'command'; text: string }
export type BuilderAnalysis = { kind: 'analysis'; module: string; parameters: Record<string, string>; processes: BuilderProcess[]; commands: BuilderCommand[]; shell: 'bash' | 'cmd' }
export type BuilderStep = BuilderAnalysis | { kind: 'collect' | 'rebase'; target: string } | { kind: 'command'; text: string; shell: 'bash' | 'cmd' }
export type BuilderDraft = { variables: string; steps: BuilderStep[] }
export type DocumentationText = { zh?: string; en?: string; und?: string }
export type ConfDocumentation = Partial<Record<'title' | 'summary' | 'inputs' | 'outputs' | 'notes', DocumentationText>>
export type BuilderCatalog = { version: number; modules: Array<{ name: string; documentation: ConfDocumentation; warnings: string[]; sections: Array<{ name: string; documentation: ConfDocumentation }> }> }
export const documentation_text = (text: DocumentationText | undefined, language: 'zh' | 'en'): { text: string; language: 'zh' | 'en' | 'und' } => {
  for (const candidate of [language, 'und', language === 'zh' ? 'en' : 'zh'] as const) {
    if (text?.[candidate]?.trim()) return { text: text[candidate]!, language: candidate }
  }
  return { text: '', language }
}
export type BuilderPreview = { source: string; inspection: WorkflowInspection }
// Presentation only: conf identifiers and scientific defaults stay untouched.

export const new_analysis = (module: string, sections: string[] = []): BuilderAnalysis => ({
  kind: 'analysis', module, parameters: {}, processes: sections.map(section => ({ section, parameters: {} })), commands: [], shell: 'bash',
})
export const esp_example = (): BuilderDraft => ({ variables: '', steps: [
  { ...new_analysis('grid', ['electron', 'esp']), commands: [
    { kind: 'rename', source: 'density.cub', target: '${input}_den.cub' },
    { kind: 'rename', source: 'totesp.cub', target: '${input}_kcal_esp.cub' },
  ] },
  { kind: 'collect', target: '${input}_ESP' },
] })
