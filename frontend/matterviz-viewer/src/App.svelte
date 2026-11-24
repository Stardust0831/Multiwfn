<script lang="ts">
  import { onMount } from 'svelte'
  import { Structure, type AnyStructure } from 'matterviz/structure'
  import { parse_structure_file } from 'matterviz/structure/parse'
  import { DEFAULT_ISOSURFACE_SETTINGS, type IsosurfaceSettings, type VolumetricData } from 'matterviz/isosurface'
  import { Atom, Download, FolderOpen, Info, Languages, RefreshCw, X } from '@lucide/svelte'
  import { load_field, field_id, layer_for_field, type SessionField } from './session-fields'
  import { adapt_matterviz_volume, decode_matterviz_volume, read_matterviz_volume_response, read_geometry_memory_budget } from './volume'
  import { cube_entries, display_range, manifest_url, plot_export, resolve_entry_url, type ManifestEntry, type MultiwfnManifest } from './manifest'
  import { extract_esp_extrema_async, type EspExtremaResult } from './esp'
  import { inject_manifest_lattice } from './periodic'
  import { initial_orbital_volume_index, loaded_orbital_volume_index, normalize_orbital_isovalue, orbital_frontier_label, ORBITAL_GRID_QUALITY_LEVELS } from './orbital'
  import { t, locale, set_locale, sync_document_locale, ui_message, format_message, type UiMessage } from './i18n'
  import { Button } from '$lib/components/ui/button'
  import WorkbenchMenu from './WorkbenchMenu.svelte'
  import WorkbenchSelect from './WorkbenchSelect.svelte'
  import MultiwfnPlotView from './MultiwfnPlotView.svelte'
  import { parse_plot, plot_title, read_plot_dataset_response } from './plot'
  import { render_plot_document } from './plot-export'
  import { cached_plot_resolver, download_blob, import_plot_document, plot_data_csv, serialize_plot_document, PLOT_FILE_LIMIT, PLOT_RESULT_LIMIT, type WorkbenchPlot } from './workbench-plots'
  import { scene_to_png_blob } from './scene-export'
  import { signal_frontend_ready } from './startup'
  import { request_return_and_close } from './return'
  import { create_update_client, type UpdateStatus } from './update'
  import UpdateModal from './UpdateModal.svelte'
  import AnalysisAction from './AnalysisAction.svelte'
  import TopologyPanel from './TopologyPanel.svelte'
  import SurfaceAnalysisPanel from './SurfaceAnalysisPanel.svelte'
  import AnalysisViewport from './AnalysisViewport.svelte'
  import { analysis_structure_key } from './analysis-structure'
  import { resolve_surface, surface_display_defaults, surface_document, surface_csv, type SurfaceResult, type SurfaceConfirmation } from './surface-analysis'
  import { parse_surface_log, SURFACE_LOG_LIMIT } from './surface-log'
  import { AIM_DEFAULTS, resolve_topology, topology_display_defaults, topology_csv, topology_document, type TopologyResult, type TopologySelection } from './topology'

  const manifestBase = manifest_url()
  let manifest = $state<MultiwfnManifest>({})
  let structure = $state.raw<AnyStructure>()
  let fields = $state.raw<SessionField[]>([])
  // Native undo restores the volume. Keep its provenance without retaining the sample buffer.
  const volumeEntriesById = new Map<string, ManifestEntry>()
  const volumetricData = $derived(fields.map(field => field.volume))
  const volumeEntries = $derived(fields.map(field => field.entry))
  let settings = $state<IsosurfaceSettings>({ ...DEFAULT_ISOSURFACE_SETTINGS })
  let activeVolume = $state<string>()
  let espExtremaOpen = $state(false)
  let espExtremaLoading = $state(false)
  let espExtrema = $state<EspExtremaResult>()
  const espPair = $derived.by(() => {
    for (const layer of settings.layers) {
      if (!layer.visible || !layer.color_volume_id) continue
      const density = fields.find(f => f.volume.id === layer.volume_id && f.entry.analysisKind === 'esp-density')
      const potential = fields.find(f => f.volume.id === layer.color_volume_id && f.entry.analysisKind === 'esp-potential')
      if (density && potential) return { density: density.volume, potential: potential.volume, iso: layer.isovalue }
    }
  })
  $effect(() => { espPair; espExtrema = undefined; espExtremaOpen = false })
  async function calculate_esp_extrema() {
    const pair = espPair
    if (!pair || espExtremaLoading) return
    espExtremaLoading = espExtremaOpen = true
    try {
      const result = await extract_esp_extrema_async(pair.density, pair.potential, pair.iso,
        { maxCells: 120000, maxSamples: 50000, maxExtrema: 12, excludeBoundary: true })
      if (espPair === pair) espExtrema = result
    } catch (error) { report_error(error) }
    finally { espExtremaLoading = false }
  }
  let backgroundColor = $state('#ffffff')
  let sceneProps = $state<import('matterviz/structure').StructureSettings>({})
  let selectedSites = $state<number[]>([])
  let loading = $state(true)
  let structureLoading = $state(false)
  let workingMessage = $state<UiMessage>(ui_message('Loading session...'))
  let errorMessage = $state('')
  let status = $state<UiMessage>(ui_message('Loading Multiwfn session...'))
  let returnPending = $state(false)
  let viewerShell: HTMLElement
  let orbitalIndex = $state(0)
  let orbitalIsovalue = $state(0.02)
  let quality = $state(120000)
  let espIsovalue = $state(0.001)
  let orbitalBackendAvailable = $state(true)
  let logOpen = $state(false)
  let plots = $state<WorkbenchPlot[]>([])
  let activeResult = $state('scene')
  let openMenu = $state<string | undefined>()
  let plotInput: HTMLInputElement
  let resultStage: HTMLDivElement
  let importingPlot = $state(false)
  let savingResult = $state(false)
  let transparentExport = $state(false)
  let orbitalPanelOpen = $state(window.innerWidth >= 760)
  let orbitalListElement = $state<HTMLDivElement>()
  const homoIndex = $derived(manifest.orbitals?.homoIndex ?? manifest.multiwfnGui?.state?.homoIndex)
  const active_plot = $derived(plots.find(plot => plot.id === activeResult))
  const scene_available = $derived(Boolean(structure))
  let logEntries = $state<Array<{ timestamp: string; level: 'info' | 'error'; message: UiMessage }>>([])
  let updateStatus = $state<UpdateStatus>()
  let updateOpen = $state(false)
  const updaterBuildEnabled = import.meta.env.VITE_MATTERVIZ_PRERELEASE_UPDATER === '1'
  const updateClient = updaterBuildEnabled ? create_update_client(new URL(window.location.href)) : undefined

  let topologyPanelOpen = $state(false)
  let topologyActive = $state(false)
  let topologyResult = $state.raw<TopologyResult>()
  let topologySelection = $state<TopologySelection>()
  let topologyOptions = $state({ ...AIM_DEFAULTS })
  let topologyDisplay = $state(topology_display_defaults())
  let topologyGeneration = 0
  let surfaceResult = $state.raw<SurfaceResult>()
  let surfacePanelOpen = $state(false)
  let surfaceActive = $state(false)
  let surfaceSelection = $state<number>()
  let surfaceDisplay = $state(surface_display_defaults())
  let analysisViewport = $state<AnalysisViewport>()
  const open_surface_results = () => {
    openMenu = undefined
    surfacePanelOpen = surfaceActive = true
    topologyPanelOpen = topologyActive = orbitalPanelOpen = false
  }
  const topologyCell = $derived(manifest.periodic?.enabled && manifest.periodic.cell?.a && manifest.periodic.cell.b && manifest.periodic.cell.c ? [manifest.periodic.cell.a, manifest.periodic.cell.b, manifest.periodic.cell.c] : undefined)
  let loadedGeometryKey = $state('')
  const geometryKey = $derived(analysis_structure_key(structure))
  const topologyReason = $derived(loadedGeometryKey && geometryKey !== loadedGeometryKey
    ? 'The displayed structure no longer matches the loaded wavefunction'
    : manifest.topologyAnalysis?.aim?.available ? '' : manifest.topologyAnalysis?.aim?.reason || 'The loaded input does not provide AIM wavefunction data')
  $effect(() => {
    if (loadedGeometryKey && geometryKey !== loadedGeometryKey) {
      topologyGeneration++
      topologyResult = undefined
      topologyActive = false
      topologySelection = undefined
      surfaceResult = undefined
      surfaceActive = false
      surfaceSelection = undefined
      surfacePanelOpen = false
    }
  })
  const show_result = (id: string) => { activeResult = id; openMenu = undefined }
  const open_plot_files = async (event: Event): Promise<void> => {
    const input = event.currentTarget as HTMLInputElement
    const files = [...(input.files ?? [])]
    if (!files.length || importingPlot) return
    importingPlot = true
    openMenu = undefined
    try {
      if (plots.length + files.length > PLOT_RESULT_LIMIT) throw new Error(`Keep at most ${PLOT_RESULT_LIMIT} plots open`)
      const imported: WorkbenchPlot[] = []
      for (const file of files) {
        if (file.size > PLOT_FILE_LIMIT) throw new Error(`${file.name} exceeds the 32 MiB plot import limit`)
        imported.push({ id: crypto.randomUUID(), ...await import_plot_document(await file.text(), file.name) })
      }
      // Apply the whole group only after validation, retaining the current scene on errors.
      plots = [...plots, ...imported]
      show_result(imported[0].id)
      errorMessage = ''
      set_status(ui_message('{count} plot(s) opened', { count: imported.length }))
    } catch (error) { report_error(error) }
    finally { importingPlot = false; input.value = '' }
  }

  const close_plot = (): void => {
    plots = plots.filter((plot) => plot.id !== activeResult)
    show_result(scene_available ? 'scene' : plots[0]?.id ?? 'scene')
  }

  const save_result = async (format: 'png' | 'pdf' | 'svg' | 'csv' | 'json'): Promise<void> => {
    if (savingResult) return
    savingResult = true
    openMenu = undefined
    const plot = active_plot
    try {
      let outcome: string
      if (plot) {
        if (format === 'csv' || format === 'json') {
          const data = format === 'csv' ? await plot_data_csv(plot) : await serialize_plot_document(plot)
          outcome = await download_blob(new Blob([data], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' }), `${plot_title(plot.artifact)}.${format}`)
        } else {
          const root = resultStage?.querySelector<HTMLElement>('.result-document:not(.inactive) [data-plot-document]')
          if (!root) throw new Error('The active plot is not ready')
          const bytes = await render_plot_document(root, format)
          outcome = await download_blob(new Blob([bytes.slice().buffer], { type: format === 'svg' ? 'image/svg+xml' : format === 'pdf' ? 'application/pdf' : 'image/png' }), `${plot_title(plot.artifact)}.${format}`)
        }
      } else {
        const canvas = viewerShell?.querySelector<HTMLCanvasElement>('canvas')
        if (!canvas) throw new Error('The 3D scene is not ready')
        const background = transparentExport ? undefined : backgroundColor
        const png = analysisViewport ? await analysisViewport.capture(background) : await scene_to_png_blob(canvas, background)
        outcome = await download_blob(png, 'Multiwfn-scene.png')
      }
      set_status(outcome === 'cancelled' ? ui_message('Save cancelled') : ui_message('{format} exported', { format: format.toUpperCase() }))
    } catch (error) { report_error(error) }
    finally { savingResult = false }
  }

  type ApiPayload = {
    topology?: unknown
    surfaceAnalysis?: unknown
    ok?: boolean
    message?: string
    layer?: ManifestEntry
    densityLayer?: ManifestEntry
    espLayer?: ManifestEntry
    method?: string
    value?: number
    quality?: number
    isovalue?: number
    components?: Record<string, number>
  }


  const unavailable_bond_method_reason = (method: string): string | undefined => {
    if (loading) return 'Another calculation is currently running'
    const capability = manifest.bondAnalysis?.methods?.[method]
    if (!capability) return `Unknown bond-order method: ${method}`
    if (capability?.available === false) return capability.reason || 'Unavailable for this session'
    return undefined
  }

  const BOND_METHOD_LABELS: Record<string, string> = {
    mayer: 'Mayer',
    gwbo: 'GWBO',
    wiberg_lowdin: 'Wiberg-Löwdin',
    mulliken: 'Mulliken',
    fbo: 'FBO',
  }

  const bond_method_label = (method: string): string =>
    BOND_METHOD_LABELS[method] ?? method
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase())

  const add_log = (message: UiMessage, level: 'info' | 'error' = 'info'): void => {
    logEntries = [...logEntries, { timestamp: new Date().toLocaleTimeString(), level, message }]
  }

  const set_status = (message: UiMessage): void => {
    status = message
    add_log(message)
  }

  const orbital_label = (item: { index: number; energy?: number; occupation?: number }): string => {
    const frontier = orbital_frontier_label(
      item.index,
      homoIndex,
      manifest.bondAnalysis?.openShell,
    )
    const energy = Number.isFinite(item.energy) ? `${Number(item.energy).toFixed(6)} Ha` : ''
    const occupation = Number.isFinite(item.occupation) ? `occ ${Number(item.occupation).toPrecision(4)}` : ''
    return [`MO ${item.index}`, frontier, energy, occupation].filter(Boolean).join(' | ')
  }

  const orbital_count = (): number => {
    const items = manifest.orbitals?.items ?? []
    return Math.max(
      0,
      Number(manifest.orbitals?.count ?? 0),
      Number(manifest.multiwfnGui?.state?.orbitalCount ?? 0),
      ...items.map((item) => Number(item.index) || 0),
      ...volumeEntries.map(entry => entry.orbitalIndex ?? 0),
    )
  }

  const orbital_index_valid = (): boolean =>
    Number.isInteger(orbitalIndex) && orbitalIndex >= 1 && orbitalIndex <= orbital_count()

  const orbital_selection_available = (): boolean => orbital_count() > 0 || volumeEntries.some((entry) =>
    entry.role?.toLowerCase() === 'orbital' || Number(entry.orbitalIndex) > 0)

  const orbital_selection_valid = (): boolean =>
    orbital_selection_available() && (orbitalIndex === 0 || orbital_index_valid())

  const move_orbital = (offset: number): void => {
    const items = manifest.orbitals?.items ?? []
    if (items.length && items.length >= orbital_count()) {
      const current = items.findIndex((item) => item.index === orbitalIndex)
      const position = current < 0 ? (offset > 0 ? -1 : 0) : current
      orbitalIndex = items[Math.max(0, Math.min(items.length - 1, position + offset))].index
      return
    }
    orbitalIndex = Math.max(1, Math.min(orbital_count() || orbitalIndex + offset, orbitalIndex + offset))
  }

  const activate_orbital = async (index: number): Promise<void> => {
    orbitalIndex = index
    await request_orbital()
  }

  const step_orbital = async (offset: number): Promise<void> => {
    move_orbital(offset)
    await request_orbital()
  }

  const report_error = (error: unknown): void => {
    errorMessage = error instanceof Error ? error.message : String(error)
    add_log(errorMessage, 'error')
  }

  const api_url = (path: string, params?: URLSearchParams): URL => {
    const url = new URL(path, manifestBase)
    if (params) url.search = params.toString()
    const capability = new URL(window.location.href).searchParams.get('cap')
    if (capability) url.searchParams.set('cap', capability)
    return url
  }

  const read_api_payload = async (response: Response): Promise<ApiPayload> => {
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      throw new Error(`Backend returned HTTP ${response.status} without JSON`)
    }
    return response.json() as Promise<ApiPayload>
  }

  const load_update_status = async (): Promise<void> => {
    if (!updateClient || !new URL(window.location.href).searchParams.get('cap')) return
    try {
      const next = await updateClient.status()
      updateStatus = next.visible ? next : undefined
    } catch {
      updateStatus = undefined
    }
  }

  const fetch_text = async (url: URL): Promise<string> => {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) throw new Error(`${url.pathname}: HTTP ${response.status}`)
    return response.text()
  }


  function replace_fields(next: SessionField[], replaced: Set<string> = new Set()) {
    const ids = new Set(next.map(field => field.volume.id))
    if (ids.size !== next.length) throw new Error('Duplicate volume in Multiwfn session')
    const previous = settings.layers.filter(layer => ids.has(layer.volume_id) && !replaced.has(layer.volume_id))
    const added = next.filter(field => !fields.some(old => old.volume.id === field.volume.id) || replaced.has(field.volume.id))
    const layers = [...previous, ...added.map(field => layer_for_field(field, next))]
    for (const field of next) volumeEntriesById.set(field.volume.id, field.entry)
    settings = { ...settings, layers }
    fields = next
  }

  function sync_native_volumes(volumes: VolumetricData[] | undefined) {
    const next = volumes ?? []
    if (next.length === fields.length && next.every((volume, index) => volume === fields[index].volume)) return
    fields = next.map(volume => ({
      volume, entry: volumeEntriesById.get(volume.id) ?? { path: volume.source ?? volume.id, name: volume.label },
    }))
  }

  async function load_manifest() {
    try {
      const response = await fetch(manifestBase, { cache: 'no-store' })
      if (!response.ok) throw new Error(`Manifest request returned HTTP ${response.status}`)
      manifest = await response.json()
      const inlinePlot = (manifest as MultiwfnManifest & { plot?: unknown }).plot
      if (inlinePlot !== undefined) {
        plots = [{ id: 'native', native: true, artifact: parse_plot(inlinePlot),
          resolver: cached_plot_resolver(async id => read_plot_dataset_response(await fetch(api_url(`/api/plot-data/${id}`)), id)) }]
        activeResult = 'native'
        set_status(plot_title(plots[0].artifact))
      } else {
        const [source, groups] = await Promise.all([
          manifest.structure && fetch_text(resolve_entry_url(manifest.structure, manifestBase)).then(text => parse_structure_file(text, manifest.structure!.path)),
          Promise.all(cube_entries(manifest).map(entry => load_field(entry, manifestBase, manifest.periodic?.enabled ?? false))),
        ])
        const atoms = source ?? groups.find(group => group.structure)?.structure
        if (atoms) structure = inject_manifest_lattice(atoms, manifest, { override: true })
        loadedGeometryKey = analysis_structure_key(structure)
        const gui = manifest.multiwfnGui
        sceneProps = { ...sceneProps, show_atoms: gui?.state?.showMolecule ?? true,
          ...(gui?.state?.showMolecule === false ? { show_bonds: 'never' } : {}),
          show_cell_vectors: manifest.periodic?.showUnitCell ?? Boolean(manifest.periodic?.enabled) }
        quality = manifest.espAnalysis?.defaultQuality ?? 120000
        orbitalIsovalue = normalize_orbital_isovalue(gui?.state?.sur_value_orb, 0.02)
        espIsovalue = manifest.espAnalysis?.defaultIsovalue ?? 0.001
        replace_fields(groups.flatMap(group => group.fields))
        settings = { ...settings, display_range: display_range(manifest) }
        orbitalIndex = Number(homoIndex ?? fields.find(f => f.entry.visible !== false && f.entry.role === 'orbital')?.entry.orbitalIndex ?? 0)
        if (gui?.entry?.toLowerCase().includes('drawmol')) {
          const index = initial_orbital_volume_index(volumeEntries, homoIndex)
          activeVolume = index === undefined ? undefined : fields[index].volume.id
          if (index !== undefined) orbitalIndex = volumeEntries[index].orbitalIndex ?? orbitalIndex
          settings = { ...settings, layers: settings.layers.map(layer => ({ ...layer, visible: layer.volume_id === activeVolume })) }
        }
        const generation = topologyGeneration
        if (manifest.topology) {
          const result = await load_topology(manifest.topology)
          if (generation === topologyGeneration && loadedGeometryKey === geometryKey) {
            topologyResult = result
            topologyActive = topologyPanelOpen = true
            orbitalPanelOpen = false
          }
        }
        if (manifest.surfaceAnalysis) {
          const result = await load_surface(manifest.surfaceAnalysis)
          if (generation === topologyGeneration && loadedGeometryKey === geometryKey) {
            surfaceResult = result
            open_surface_results()
          }
        }
        set_status(fields.length ? ui_message('{count} volume layer(s) loaded', { count: fields.length }) : ui_message('Structure loaded'))
      }
      await signal_frontend_ready()
    } catch (error) { report_error(error) }
    finally { loading = false }
  }

  function show_orbital(id?: string) {
    const orbitalIds = new Set(fields.filter(f => f.entry.role === 'orbital').map(f => f.volume.id))
    const layers = settings.layers.map(layer => orbitalIds.has(layer.volume_id)
      ? { ...layer, visible: layer.volume_id === id } : layer)
    const field = fields.find(field => field.volume.id === id)
    if (field && !layers.some(layer => layer.volume_id === id))
      layers.push({ ...layer_for_field(field, fields), visible: true, isovalue: orbitalIsovalue })
    settings = { ...settings, layers }
    if (id) activeVolume = id
    topologyActive = surfaceActive = false
  }

  async function request_orbital(options: { forceRecompute?: boolean } = {}) {
    if (loading || structureLoading) return
    const index = orbitalIndex
    if (index === 0) { show_orbital(); return }
    if (!orbital_index_valid()) return
    if (loadedGeometryKey !== geometryKey) {
      report_error(new Error('The displayed structure no longer matches the loaded wavefunction'))
      return
    }
    const generation = topologyGeneration
    const cached = fields.find(field => field.entry.orbitalIndex === index)
    if (cached && !options.forceRecompute) { show_orbital(cached.volume.id); return }
    loading = true
    errorMessage = ''
    workingMessage = ui_message('Calculating orbital {number}...', { number: index })
    try {
      const activeBytes = fields.reduce((bytes, field) => bytes + field.volume.values.byteLength, 0)
      const params = new URLSearchParams({ index: String(index), quality: String(quality), isovalue: String(orbitalIsovalue), activeVolumeBytes: String(activeBytes) })
      const response = await fetch(api_url('/api/orbital', params), { cache: 'no-store' })
      let result: SessionField[]
      if (response.ok && response.headers.get('content-type')?.includes('application/vnd.multiwfn.volume')) {
        read_geometry_memory_budget(response.headers, true)
        const decoded = decode_matterviz_volume(await read_matterviz_volume_response(response))
        if (decoded.protocol_major !== 2 || decoded.quantity_kind !== 'orbital') throw new Error('Unexpected orbital response')
        const entry: ManifestEntry = { name: `Orbital ${index}`, path: '/api/orbital', role: 'orbital', mode: 'signed',
          format: 'mwfn-volume-v2', orbitalIndex: index, gridQuality: quality, isovalue: orbitalIsovalue }
        const volume = adapt_matterviz_volume(decoded, field_id(entry))
        volume.label = entry.name
        result = [{ entry, volume }]
      } else {
        const payload = await read_api_payload(response)
        if (!response.ok || !payload.ok || !payload.layer) throw new Error(payload.message || 'Orbital calculation failed')
        result = (await load_field({ ...payload.layer, role: 'orbital', orbitalIndex: index, isovalue: orbitalIsovalue }, manifestBase, manifest.periodic?.enabled ?? false)).fields
      }
      if (generation !== topologyGeneration || loadedGeometryKey !== geometryKey) return
      // The native endpoint streams a new field on every calculation. Keep only the current
      // streamed orbital and fields still used to color another surface.
      const colorIds = new Set(settings.layers.filter(l => l.visible).map(l => l.color_volume_id))
      const retained = fields.filter(f => f.entry.orbitalIndex !== index &&
        !(f.entry.path === '/api/orbital' && !colorIds.has(f.volume.id)))
      replace_fields([...retained, ...result], new Set(result.map(f => f.volume.id)))
      show_orbital(result[0].volume.id)
      set_status(ui_message('Orbital {number} loaded', { number: index }))
    } catch (error) {
      if (String(error).includes('Multiwfn backend unavailable')) orbitalBackendAvailable = false
      orbitalIndex = fields.find(f => f.entry.role === 'orbital' && settings.layers.some(l => l.volume_id === f.volume.id && l.visible))?.entry.orbitalIndex ?? 0
      report_error(error)
    } finally { loading = false }
  }
  const change_orbital_quality = async (event: Event): Promise<void> => {
    const nextQuality = Number((event.currentTarget as HTMLSelectElement).value)
    if (!Number.isFinite(nextQuality)) return
    quality = nextQuality
    if (orbital_index_valid()) await request_orbital({ forceRecompute: true })
  }

  function change_orbital_isovalue(value: number) {
    orbitalIsovalue = normalize_orbital_isovalue(value, orbitalIsovalue)
    const field = fields.find(f => f.entry.orbitalIndex === orbitalIndex)
    if (field) settings = { ...settings, layers: settings.layers.map(layer => layer.volume_id === field.volume.id
      ? { ...layer, isovalue: orbitalIsovalue } : layer) }
  }
  async function request_esp() {
    if (loading || structureLoading || loadedGeometryKey !== geometryKey) return
    const generation = topologyGeneration
    loading = true
    errorMessage = ''
    workingMessage = ui_message('Calculating ESP...')
    try {
      const params = new URLSearchParams({ quality: String(quality), isovalue: String(espIsovalue) })
      const response = await fetch(api_url('/api/esp', params), { cache: 'no-store' })
      const payload = await read_api_payload(response)
      if (!response.ok || !payload.ok || !payload.densityLayer || !payload.espLayer) throw new Error(payload.message || 'ESP calculation failed')
      const entries = [payload.densityLayer, { ...payload.espLayer, visible: false }]
      const result = (await Promise.all(entries.map(entry => load_field(entry, manifestBase, manifest.periodic?.enabled ?? false)))).flatMap(group => group.fields)
      if (generation !== topologyGeneration || loadedGeometryKey !== geometryKey) return
      const retained = fields.filter(f => f.entry.analysisKind !== 'esp-density' && f.entry.analysisKind !== 'esp-potential')
      replace_fields([...retained, ...result], new Set(result.map(f => f.volume.id)))
      activeVolume = result[0].volume.id
      topologyActive = surfaceActive = false
      set_status(ui_message('ESP mapped onto the electron-density surface'))
    } catch (error) { report_error(error) }
    finally { loading = false }
  }
  const load_topology = (value: unknown): Promise<TopologyResult> => resolve_topology(value, async (datasetId) => {
    const response = await fetch(api_url(`/api/plot-data/${datasetId}`), { cache: 'no-store' })
    return read_plot_dataset_response(response, datasetId)
  })

  const request_topology = async (): Promise<void> => {
    if (loading || structureLoading || topologyReason) return
    const generation = topologyGeneration
    const geometry = geometryKey
    loading = true
    workingMessage = ui_message('Calculating AIM critical points and paths...')
    errorMessage = ''
    add_log('Starting AIM critical-point search and path generation')
    try {
      const params = new URLSearchParams(Object.entries(topologyOptions).map(([key, value]) => [key, String(value)]))
      const response = await fetch(api_url('/api/topology', params), { cache: 'no-store' })
      const payload = await read_api_payload(response)
      if (generation !== topologyGeneration || geometry !== geometryKey) return
      if (!response.ok || !payload.ok || !payload.topology) throw new Error(payload.message || 'AIM calculation failed')
      workingMessage = ui_message('Loading topology coordinates...')
      const result = await load_topology(payload.topology)
      if (generation !== topologyGeneration || geometry !== geometryKey) return
      topologyResult = result
      surfaceActive = false
      surfacePanelOpen = false
      topologySelection = undefined
      topologyActive = true
      topologyPanelOpen = true
      activeResult = 'scene'
      set_status(ui_message('AIM: {points} critical points, {paths} paths', { points: result.metadata.criticalPoints.length, paths: result.metadata.paths.length }))
      add_log(`AIM finished: N-B+R-C = ${result.metadata.eulerCount}; unconnected path directions: ${result.metadata.missingPathDirections}`)
    } catch (error) {
      if (generation === topologyGeneration && geometry === geometryKey) report_error(error)
    } finally {
      loading = false
    }
  }

  const export_topology = async (format: 'json' | 'csv'): Promise<void> => {
    if (!topologyResult) return
    const text = format === 'json' ? topology_document(topologyResult) : topology_csv(topologyResult)
    try {
      const outcome = await download_blob(new Blob([text], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' }), `Multiwfn-topology.${format}`)
      set_status(outcome === 'cancelled' ? ui_message('Save cancelled') : ui_message('{format} exported', { format: format.toUpperCase() }))
    } catch (error) { report_error(error) }
  }
  const load_surface = (metadata: unknown) => resolve_surface(metadata, async (datasetId) => {
    const response = await fetch(api_url(`/api/plot-data/${datasetId}`), { cache: 'no-store' })
    return read_plot_dataset_response(response, datasetId)
  })
  const confirm_surface = async (confirmation: SurfaceConfirmation): Promise<void> => {
    if (loading || structureLoading || !surfaceResult) return
    const generation = topologyGeneration, geometry = geometryKey, previous = surfaceResult
    loading = true
    workingMessage = ui_message('Reading confirmed surface data...')
    try {
      const params = new URLSearchParams({ surfaceType: String(confirmation.surfaceType), mappedFunction: confirmation.mappedFunction === null ? 'none' : String(confirmation.mappedFunction) })
      const response = await fetch(api_url('/api/surface', params), { cache: 'no-store' })
      const payload: ApiPayload = await response.json()
      if (generation !== topologyGeneration || geometry !== geometryKey) return
      if (!response.ok || !payload.ok || !payload.surfaceAnalysis) throw new Error(payload.message || 'Surface confirmation failed')
      const result = await load_surface(payload.surfaceAnalysis)
      if (generation !== topologyGeneration || geometry !== geometryKey) return
      if (previous.metadata.statisticsSource) result.metadata = { ...result.metadata, volume: previous.metadata.volume, massDensity: previous.metadata.massDensity, statisticsSource: previous.metadata.statisticsSource }
      surfaceResult = result
      surfaceSelection = undefined
      errorMessage = ''
      set_status(ui_message('Surface types confirmed; original data loaded'))
    } catch (error) {
      if (generation === topologyGeneration && geometry === geometryKey) report_error(error)
    } finally { loading = false; workingMessage = ui_message('') }
  }
  const import_surface_log = async (event: Event): Promise<void> => {
    const input = event.currentTarget as HTMLInputElement, file = input.files?.[0], original = surfaceResult
    if (!file || !original || loading) { input.value = ''; return }
    const generation = topologyGeneration
    try {
      if (file.size > SURFACE_LOG_LIMIT) throw new Error('Surface logs are limited to 8 MiB')
      const text = await file.text()
      if (generation !== topologyGeneration || surfaceResult !== original || loading) return
      const stats = parse_surface_log(text, original)
      surfaceResult = { ...original, metadata: { ...original.metadata, ...stats, statisticsSource: { source: 'log', filename: file.name, precision: 'printed' } } }
      errorMessage = ''
      set_status(ui_message('Printed surface statistics imported; area matches the current mesh'))
    } catch (error) {
      if (generation === topologyGeneration && surfaceResult === original) report_error(error)
    } finally { input.value = '' }
  }
  const clear_surface_log = (): void => {
    if (!surfaceResult || loading) return
    surfaceResult = { ...surfaceResult, metadata: { ...surfaceResult.metadata, volume: null, massDensity: null, statisticsSource: undefined } }
  }
  const export_surface = async (format: 'json' | 'csv'): Promise<void> => {
    if (!surfaceResult) return
    const text = format === 'json' ? surface_document(surfaceResult) : surface_csv(surfaceResult)
    try {
      const outcome = await download_blob(new Blob([text], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' }), `Multiwfn-quantitative-surface.${format}`)
      set_status(outcome === 'cancelled' ? ui_message('Save cancelled') : ui_message('{format} exported', { format: format.toUpperCase() }))
    } catch (error) { report_error(error) }
  }

  let bondMethod = $state('mayer')
  let bondResults = $state<{ key: string; atoms: string; method: string; value: number }[]>([])
  type BondPair = [number, number]
  const selected_source_bond_pair = (): BondPair | undefined =>
    loadedGeometryKey === geometryKey && selectedSites.length === 2 && selectedSites.every(i => Number.isInteger(i) && i >= 0 && i < (structure?.sites.length ?? 0))
      ? [selectedSites[0], selectedSites[1]] : undefined
  const request_bond = async (): Promise<void> => {
    if (loading || structureLoading) return
    const selected = selected_source_bond_pair()
    if (!selected) {
      report_error(new Error('Select two atoms with the MatterViz measurement tool'))
      return
    }
    const method = bondMethod
    const capability = manifest.bondAnalysis?.methods?.[method]
    if (!capability) {
      report_error(new Error(`Unknown bond-order method: ${method}`))
      return
    }
    if (capability.available === false) {
      report_error(new Error(capability.reason || `${method} is unavailable for this session`))
      return
    }
    loading = true
    errorMessage = ''
    const atom1 = selected[0] + 1
    const atom2 = selected[1] + 1
    const sourceStructure = structure
    workingMessage = ui_message('Calculating {method} bond order...', { method: bond_method_label(method) })
    add_log(`Requesting ${method} bond order for atoms ${atom1} and ${atom2}`)
    try {
      const params = new URLSearchParams({ atom1: String(atom1), atom2: String(atom2), method })
      const response = await fetch(api_url('/api/bond', params), { cache: 'no-store' })
      const payload = await read_api_payload(response)
      if (!response.ok || !payload.ok || !Number.isFinite(Number(payload.value))) {
        throw new Error(payload.message || 'Bond-order calculation failed')
      }
      if (structure !== sourceStructure) return
      const key = `${Math.min(atom1, atom2)}:${Math.max(atom1, atom2)}:${method}`
      const names = selected.map((index) => `${sourceStructure?.sites[index]?.species?.[0]?.element ?? 'Atom'}${index + 1}`).join(' - ')
      bondResults = [...bondResults.filter((result) => result.key !== key), {
        key, atoms: names, method: bond_method_label(method), value: Number(payload.value),
      }]
      set_status(`${method}(${atom1}, ${atom2}) = ${Number(payload.value).toFixed(6)}`)
    } catch (error) {
      report_error(error)
    } finally {
      loading = false
    }
  }

  const return_to_multiwfn = async (): Promise<void> => {
    if (returnPending) return
    returnPending = true
    await request_return_and_close({
      request: async () => {
        const response = await fetch(api_url('/api/return'), { cache: 'no-store' })
        const payload = await read_api_payload(response)
        if (!response.ok || !payload.ok) throw new Error(payload.message || 'Return request failed')
      },
      close: () => window.close(),
      onReturned: () => set_status(ui_message('Returning to Multiwfn...')),
      onError: report_error,
    })
    returnPending = false
  }

  const copy_log = async (): Promise<void> => {
    const text = logEntries.map((entry) => `[${entry.timestamp}] ${entry.level.toUpperCase()} ${format_message('en', entry.message)}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      set_status(ui_message('Log copied to clipboard'))
    } catch (error) {
      report_error(error)
    }
  }

  $effect(() => {
    structure
    bondResults = []
  })

  // Scroll only this list, never the page or the molecular canvas.
  $effect(() => {
    const list = orbitalListElement
    const selected = orbitalIndex
    const frontier = homoIndex
    const visible = activeResult === 'scene' && orbitalPanelOpen
    if (!list || !visible) return
    const frame = requestAnimationFrame(() => {
      const target = list.querySelector<HTMLElement>(`[data-orbital-index="${selected || frontier}"]`)
      if (!target) return
      const next = selected === frontier ? list.querySelector<HTMLElement>(`[data-orbital-index="${Number(frontier) + 1}"]`) : undefined
      const listRect = list.getBoundingClientRect()
      const top = target.getBoundingClientRect().top - listRect.top + list.scrollTop
      const bottom = (next ?? target).getBoundingClientRect().bottom - listRect.top + list.scrollTop
      list.scrollTop = Math.max(0, (top + bottom - list.clientHeight) / 2)
    })
    return () => cancelAnimationFrame(frame)
  })

  onMount(sync_document_locale)
  onMount(() => {
    void load_manifest()
    void load_update_status()
  })
</script>
<main class="workbench">
  <header class="toolbar">
    <div class="brand">
      <div class="brand-mark"><Atom size={21} strokeWidth={1.6} /></div>
      <div class="brand-copy"><strong>Multiwfn</strong><span>{$t("Molecular workbench")}</span></div>
    </div>
    <div class="result-picker">
      <WorkbenchSelect label="Active result" translateOptions={false} value={activeResult} disabled={savingResult}
        options={[{ value: 'scene', label: $t('3D scene'), disabled: !scene_available }, ...plots.map((plot) => ({ value: plot.id, label: plot_title(plot.artifact) }))]}
        onchange={show_result} />
    </div>
    <Button variant="ghost" size="sm" type="button" title={$t("Open numeric curves or a saved plot document")} onclick={() => plotInput?.click()} disabled={importingPlot || savingResult}>
      <FolderOpen size={16} /><span>{$t("Open plot")}</span>
    </Button>
    <input class="hidden-file-input" bind:this={plotInput} type="file" accept=".txt,.dat,.csv,.json" multiple onchange={open_plot_files} />
    {#if activeResult === 'scene'}
    <WorkbenchMenu name="tools" label="Tools" bind:active={openMenu}>
      {#if orbital_selection_available()}
        <label><input type="checkbox" bind:checked={orbitalPanelOpen} />{$t('Orbitals')}</label>
      {/if}
    <div class="menu-heading">{$t("Quantitative molecular surface")}</div>
    <AnalysisAction reason={surfaceResult ? '' : 'Run main function 12, then choose post-processing option 0 to view its results'} busy={false} onclick={open_surface_results}>{$t("Quantitative surface results...")}</AnalysisAction>
    <div class="menu-heading">{$t("Topology analysis (AIM)")}</div>
    <AnalysisAction reason={topologyResult ? '' : topologyReason} busy={loading} onclick={() => { openMenu = undefined; surfacePanelOpen = surfaceActive = false; topologyPanelOpen = true; topologyActive = Boolean(topologyResult); orbitalPanelOpen = false }}>{$t("AIM critical points and paths...")}</AnalysisAction>
    <div class="menu-heading">{$t("Electrostatic potential")}</div>
    <label>
      <span>{$t("Density iso")}</span>
      <input type="number" min="0.000001" max="0.1" step="0.0001" bind:value={espIsovalue} />
    </label>
    <AnalysisAction
      onclick={() => { openMenu = undefined; void request_esp() }}
      busy={loading}
      reason={loadedGeometryKey !== geometryKey ? 'The displayed structure no longer matches the loaded wavefunction' : manifest.espAnalysis?.available === true ? '' : manifest.espAnalysis?.reason || 'No ESP calculation is available in this session'}
    >{$t("ESP surface")}</AnalysisAction>
    {#if espPair}
      <Button variant="ghost" size="sm" type="button" onclick={calculate_esp_extrema} disabled={espExtremaLoading}>{$t("Approx. ESP extrema")}</Button>
    {/if}
    <div class="menu-heading">{$t("Bond-order analysis")}</div>
    {#each ['mayer', 'gwbo', 'wiberg_lowdin', 'mulliken', 'fbo'] as method}
      <AnalysisAction
        onclick={() => { openMenu = undefined; bondMethod = method; void request_bond() }}
        busy={loading}
        reason={manifest.bondAnalysis?.methods?.[method]?.available !== true ? manifest.bondAnalysis?.methods?.[method]?.reason || 'Basis-function and density information is unavailable' : unavailable_bond_method_reason(method) || (!selected_source_bond_pair() ? 'Use the measurement tool to select two atoms' : '')}
      >{bond_method_label(method)}</AnalysisAction>
    {/each}
    </WorkbenchMenu>
    {/if}
    <WorkbenchMenu name="save" label="Save" bind:active={openMenu}>
      {#if !active_plot}
        <label><input type="checkbox" bind:checked={transparentExport} disabled={savingResult} /><span>{$t("Transparent background")}</span></label>
      {/if}
      <Button variant="ghost" size="sm" type="button" onclick={() => save_result('png')} disabled={savingResult || (!active_plot && !scene_available)}><Download size={16} />{$t("PNG image")}</Button>
      {#if active_plot}
        <Button variant="ghost" size="sm" type="button" onclick={() => save_result('pdf')} disabled={savingResult}>{$t("PDF figure")}</Button>
        <Button variant="ghost" size="sm" type="button" onclick={() => save_result('svg')} disabled={savingResult}>{$t("SVG figure")}</Button>
        <Button variant="ghost" size="sm" type="button" onclick={() => save_result('csv')} disabled={savingResult}>{$t("CSV numeric data")}</Button>
        <Button variant="ghost" size="sm" type="button" onclick={() => save_result('json')} disabled={savingResult}>{$t("Plot document (.json)")}</Button>
      {/if}
    </WorkbenchMenu>
    {#if active_plot && !active_plot.native}
      <Button variant="ghost" size="sm" class="icon-button" type="button" title={$t("Close current plot")} aria-label={$t("Close current plot")} onclick={close_plot} disabled={savingResult}><X size={16} /></Button>
    {/if}
    <Button variant="ghost" size="sm" class="icon-button" type="button" title={$t("Operation log")} aria-label={$t("Operation log")} onclick={() => logOpen = !logOpen} aria-expanded={logOpen}><Info size={16} /></Button>
    {#if updaterBuildEnabled && updateStatus?.visible}
      <Button variant="ghost" size="sm" class="icon-button update-toolbar-button" type="button" title={$t("Open updater")} aria-label={$t("Open updater")} onclick={() => updateOpen = true}>
        <RefreshCw size={16} />
      </Button>
    {/if}
    <Button variant="outline" size="sm" type="button" class="language-toggle gap-1.5 text-xs" aria-label={$locale === 'zh' ? 'Switch to English' : '切换到中文'} title={$locale === 'zh' ? 'Switch to English' : '切换到中文'} onclick={() => set_locale($locale === 'zh' ? 'en' : 'zh')}>
      <Languages size={15} aria-hidden="true" /><span lang="zh-CN" class:language-active={$locale === 'zh'}>中文</span><span aria-hidden="true">/</span><span lang="en" class:language-active={$locale === 'en'}>EN</span>
    </Button>
    <Button variant="outline" size="sm" class="return text-xs" type="button" title={$t("Return to the Multiwfn calculation menu")} onclick={return_to_multiwfn} disabled={returnPending || savingResult}>{$t("Return")}</Button>
  </header>

  <div class="result-stage" bind:this={resultStage}>
    <section class="session-scene" class:inactive={activeResult !== 'scene'} inert={activeResult !== 'scene'} aria-hidden={activeResult !== 'scene'}>
      {#if surfacePanelOpen && surfaceResult}
        <SurfaceAnalysisPanel result={surfaceResult} bind:display={surfaceDisplay} bind:active={surfaceActive} bind:selection={surfaceSelection}
          busy={loading || structureLoading} onclose={() => { surfacePanelOpen = surfaceActive = false }} onexport={export_surface}
          onfit={() => analysisViewport?.fit()} onconfirm={confirm_surface} onlog={import_surface_log} onclearlog={clear_surface_log} />
      {:else if topologyPanelOpen}
        <TopologyPanel bind:options={topologyOptions} bind:display={topologyDisplay} bind:active={topologyActive} bind:selection={topologySelection}
          result={topologyResult} busy={loading} reason={topologyReason} cell={topologyCell} onrun={request_topology}
          onclose={() => { topologyPanelOpen = topologyActive = false }} onexport={export_topology} />
      {/if}
      <section class="viewer-shell">
        <div class="scene-viewport" bind:this={viewerShell}>
          {#if (surfaceActive && surfaceResult) || (topologyActive && topologyResult)}
            <AnalysisViewport bind:this={analysisViewport} surface={surfaceActive ? surfaceResult : undefined} {surfaceDisplay}
              bind:surfaceSelection topology={topologyActive ? topologyResult : undefined} {topologyDisplay}
              bind:topologySelection cell={topologyCell} />
          {:else if structure}
            <Structure bind:structure bind:volumetric_data={() => volumetricData, sync_native_volumes} bind:isosurface_settings={settings}
              bind:active_volume_id={activeVolume} bind:scene_props={sceneProps} bind:background_color={backgroundColor}
              bind:selected_sites={selectedSites} bind:loading={structureLoading}
              show_controls="always" allow_file_drop={false} on_error={event => report_error(event.error_msg)} />
          {:else if !loading}
            <div class="empty">{$t('No structure is available in this session.')}</div>
          {/if}
        </div>
        {#if loading || bondResults.length}
          <div class="scene-readouts">
            {#if loading}<div class="calculation-status" role="status"><progress></progress>{format_message($locale, workingMessage)}</div>{/if}
            {#each bondResults as result (result.key)}<p>{result.atoms} · {result.method} {result.value.toPrecision(6)}</p>{/each}
          </div>
        {/if}
      </section>
    {#if orbital_selection_available() && orbitalPanelOpen}
      <aside class="orbital-panel" aria-label={$t("Orbital controls")}>
        <header>
          <div><strong>{$t("Orbitals")}</strong><small>{orbital_count()}</small></div>
          <span class:offline={!orbitalBackendAvailable}>{$t(orbitalBackendAvailable ? 'Connected' : 'Cached only')}</span>
        </header>
        <div class="orbital-frontiers" aria-label={$t("Frontier orbitals")}>
          {#each [Number(homoIndex), Number(homoIndex) + 1] as index}
            {@const label = orbital_frontier_label(index, homoIndex, manifest.bondAnalysis?.openShell)}
            {#if label && index <= orbital_count()}
              <button type="button" class:active={orbitalIndex === index} onclick={() => activate_orbital(index)}
                disabled={loading || (!orbitalBackendAvailable && loaded_orbital_volume_index(volumeEntries, index) === undefined)}>{label} <strong>{index}</strong></button>
            {/if}
          {/each}
        </div>
        {#if manifest.orbitals?.items?.length}
          <div class="orbital-list" bind:this={orbitalListElement} role="listbox" aria-label={$t("Orbital list")}>
            <button type="button" class:active={orbitalIndex === 0} role="option" aria-selected={orbitalIndex === 0} onclick={() => activate_orbital(0)} disabled={loading}>{$t("None")}</button>
            {#each manifest.orbitals.items as item}
              <button
                type="button"
                class:active={orbitalIndex === item.index}
                data-orbital-index={item.index}
                role="option"
                aria-selected={orbitalIndex === item.index}
                title={orbital_label(item)}
                onclick={() => activate_orbital(item.index)}
                disabled={loading || (!orbitalBackendAvailable && loaded_orbital_volume_index(volumeEntries, item.index) === undefined)}
              >
                <span>MO {item.index}</span>
                <small>{orbital_frontier_label(item.index, homoIndex, manifest.bondAnalysis?.openShell) || (Number.isFinite(item.energy) ? `${Number(item.energy).toFixed(4)} Ha` : '')}</small>
              </button>
            {/each}
          </div>
        {/if}
        <div class="orbital-controls">
          <div class="orbital-navigation">
            <button type="button" title={$t("Previous orbital")} aria-label={$t("Previous orbital")} onclick={() => step_orbital(-1)} disabled={loading || orbitalIndex <= 1}>&lt;</button>
            <input aria-label={$t("Orbital index")} type="number" min="0" max={orbital_count() || undefined} bind:value={orbitalIndex} disabled={loading} />
            <button type="button" title={$t("Next orbital")} aria-label={$t("Next orbital")} onclick={() => step_orbital(1)} disabled={loading || orbitalIndex >= orbital_count()}>&gt;</button>
          </div>
          <button type="button" onclick={() => request_orbital()} disabled={loading || !orbital_selection_valid() || (!orbitalBackendAvailable && loaded_orbital_volume_index(volumeEntries, orbitalIndex) === undefined)}>{$t(orbitalIndex === 0 ? 'Hide orbitals' : 'Show orbital')}</button>
          <label>
            <span>{$t("Orbital isovalue")}</span>
            <input type="number" min="0.000001" max="0.3" step="0.001" value={orbitalIsovalue} onchange={(event) => change_orbital_isovalue(event.currentTarget.valueAsNumber)} />
          </label>
          <label>
            <span>{$t("Grid precision")}</span>
            <select value={quality} onchange={change_orbital_quality} disabled={loading || !orbitalBackendAvailable}>
              {#each manifest.espAnalysis?.qualityLevels ?? ORBITAL_GRID_QUALITY_LEVELS as level}
                <option value={level}>{Math.round(level / 1000)}{$t("k points")}</option>
              {/each}
            </select>
          </label>
          {#if !orbitalBackendAvailable}<p>{$t("Reopen Multiwfn menu 0 to calculate uncached orbitals.")}</p>{/if}
        </div>
      </aside>
    {/if}
  </section>
  {#each plots as plot (plot.id)}
    <section class="result-document" class:inactive={activeResult !== plot.id} inert={activeResult !== plot.id} aria-hidden={activeResult !== plot.id} aria-label={plot.artifact.title}>
      <MultiwfnPlotView artifact={plot.artifact} resolver={plot.resolver}
        exportConfig={plot.native ? plot_export(manifest) : undefined}
        onExported={return_to_multiwfn} onExportError={report_error} />
    </section>
  {/each}
  </div>

  <footer class="statusbar" class:error={Boolean(errorMessage)}>
    <span role="status">{savingResult ? $t('Exporting...') : importingPlot ? $t('Opening plot...') : errorMessage || format_message($locale, status)}</span>
    <span>{active_plot ? $t('2D plot') : $t('{count} volume(s)', { count: volumetricData?.length || 0 })}</span>
  </footer>
  {#if logOpen}
    <aside class="log-panel" aria-label={$t("Operation log")}>
      <header>
        <strong>{$t("Operation log")}</strong>
        <div>
          <button type="button" onclick={copy_log} disabled={!logEntries.length}>{$t("Copy")}</button>
          <button type="button" onclick={() => logEntries = []} disabled={!logEntries.length}>{$t("Clear")}</button>
          <button type="button" onclick={() => logOpen = false}>{$t("Close")}</button>
        </div>
      </header>
      <div class="log-list">
        {#each logEntries as entry}
          <div class:error={entry.level === 'error'}>
            <time>{entry.timestamp}</time>
            <span>{format_message($locale, entry.message)}</span>
          </div>
        {:else}
          <div class="log-empty">{$t("No operations recorded.")}</div>
        {/each}
      </div>
    </aside>
  {/if}
  {#if activeResult === 'scene' && !topologyActive && !surfaceActive && espExtremaOpen && espPair}
    <aside class="esp-extrema-panel" aria-label={$t("Approximate ESP surface extrema")}>
      <header>
        <strong>{$t("Approximate ESP extrema")}</strong>
        <button type="button" onclick={() => espExtremaOpen = false}>{$t("Close")}</button>
      </header>
      {#if espExtremaLoading}
        <div class="panel-empty">{$t("Calculating bounded visual estimates...")}</div>
      {:else if espExtrema}
        <div class="esp-extrema-list">
          {#each [...espExtrema.minima, ...espExtrema.maxima] as point}
            <div class:minimum={point.type === 'minimum'}>
              <strong>{$t(point.type === 'minimum' ? 'Min' : 'Max')} {point.rank}</strong>
              <span>{point.kcalMolPerElectron.toFixed(2)} kcal/mol/e</span>
              <small>{point.x.toFixed(3)}, {point.y.toFixed(3)}, {point.z.toFixed(3)}</small>
            </div>
          {:else}
            <div class="panel-empty">{$t("No finite interior extrema found.")}</div>
          {/each}
        </div>
      {/if}
    </aside>
  {/if}
  {#if updaterBuildEnabled && updateStatus?.visible}
    <UpdateModal open={updateOpen} page={new URL(window.location.href)} initial_status={updateStatus} onstatus={(status) => updateStatus = status} onclose={() => updateOpen = false} />
  {/if}
</main>

<style>
  .session-scene { position: absolute; inset: 0; display: flex; min-width: 0; }
  .viewer-shell { flex: 1; }
  .session-scene :global(.orbital-panel) { width: min(260px, 30%); }
  .session-scene :global(.topology-panel), .session-scene :global(.surface-analysis-panel) { width: min(288px, 32%); }
  @media (max-width: 760px) {
    .session-scene { flex-direction: column; }
    .session-scene :global(.orbital-panel), .session-scene :global(.topology-panel), .session-scene :global(.surface-analysis-panel) {
      width: 100%; max-height: 40%; overflow: auto;
    }
  }
</style>
