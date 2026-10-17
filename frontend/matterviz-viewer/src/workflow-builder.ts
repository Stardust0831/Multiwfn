import type { WorkflowInspection } from './workflows'

export type BuilderProcess = { section: string; parameters: Record<string, string> }
export type BuilderCommand = { kind: 'rename'; source: string; target: string } | { kind: 'command'; text: string }
export type BuilderAnalysis = { kind: 'analysis'; module: string; parameters: Record<string, string>; processes: BuilderProcess[]; commands: BuilderCommand[]; shell: 'bash' | 'cmd' }
export type BuilderStep = BuilderAnalysis | { kind: 'collect' | 'rebase'; target: string } | { kind: 'command'; text: string; shell: 'bash' | 'cmd' }
export type BuilderDraft = { variables: string; steps: BuilderStep[] }
export type BuilderCatalog = { version: number; modules: Array<{ name: string; sections: Array<{ name: string; notes: string }> }> }
export type BuilderPreview = { source: string; inspection: WorkflowInspection }
// Presentation only: conf identifiers and scientific defaults stay untouched.
export const module_labels: Record<string, string> = { grid:'Real-space grids', 'hole-ele':'Hole–electron analysis', excit:'Excited-state analysis', fmo:'Molecular orbitals', charge:'Atomic charges', bond_order:'Bond orders', weak:'Weak interactions', surface:'Surface analysis', aromatic:'Aromaticity', edaff:'Energy decomposition' }
export const section_labels: Record<string, Record<string, string>> = {
  grid:{ wfn2:'Operator transformation', electron:'Electron density', spin:'Spin density', elf:'Electron localization function', lol:'Localized orbital locator', esp:'Electrostatic potential', alie:'Average local ionization energy', leae:'Local electron attachment energy' },
  'hole-ele':{ cub:'Hole and electron Cubes', overlap:'Hole–electron overlap', transdens:'Transition density', tdm:'Transition dipole moment density', cdd:'Charge density difference' },
  excit:{ nto:'Natural transition orbitals', no:'Natural orbitals', ifct:'Interfragment charge transfer', ifctdata:'Charge transfer data', holeheatmap:'Hole–electron heatmap' },
  fmo:{ orb:'Orbital by label', orb_num:'Orbital by index' },
}

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
