<script lang="ts">
  import {
    DEFAULT_ISOSURFACE_SETTINGS,
    Icon,
    Structure,
    auto_color_config,
    compare_volume_grids,
    parse_volumetric_file,
    type AnyStructure,
    type IsosurfaceLayer,
    type IsosurfaceSettings,
    type VolumetricData,
    type MeasureMode,
  } from 'matterviz'
  import { parse_any_structure } from 'matterviz/structure/parse'
  import { onMount, tick, untrack } from 'svelte'
  import { PerspectiveCamera, OrthographicCamera } from 'three'
  import { camera_update_matches, normalize_camera_pose, normalize_camera_step, pan_camera, rotate_camera, zoom_camera, type CameraDirection, type CameraPose } from './camera'
  import EspLegend from './EspLegend.svelte'
  import TopologyPanel from './TopologyPanel.svelte'
  import AnalysisAction from './AnalysisAction.svelte'
  import TopologyOverlay from './TopologyOverlay.svelte'
  import SurfaceAnalysisOverlay from './SurfaceAnalysisOverlay.svelte'
  import SurfaceAnalysisPanel from './SurfaceAnalysisPanel.svelte'
  import SpectrumControls from './SpectrumControls.svelte'
  import { SPECTRUM_KINDS, SPECTRUM_NAMES, SPECTRUM_FILE_LIMIT, SPECTRUM_DATA_LIMIT, spectrum_defaults, spectrum_kind, type SpectrumData, type SpectrumKind, type SpectrumSettings } from './spectra'
  import type { PlotArtifact } from './plot'
  import { resolve_surface, surface_display_defaults, surface_document, surface_csv, type SurfaceResult } from './surface-analysis'
  import { AIM_DEFAULTS, resolve_topology, topology_display_defaults, topology_csv, topology_document, type TopologyResult, type TopologySelection } from './topology'
  import MultiwfnPlotView from './MultiwfnPlotView.svelte'
  import SlicePanel from './SlicePanel.svelte'
  import ViewerInspector from './ViewerInspector.svelte'
  import WorkbenchMenu from './WorkbenchMenu.svelte'
  import MeasurementReadout, { type BondResult } from './MeasurementReadout.svelte'
  import { canvas_to_png_blob, scene_registry } from 'matterviz'
  import { render_plot_document } from './plot-export'
  import {
    cached_plot_resolver, download_blob, import_plot_document, plot_data_csv,
    serialize_plot_document, PLOT_FILE_LIMIT, PLOT_RESULT_LIMIT, type WorkbenchPlot,
  } from './workbench-plots'
  import {
    ESP_COLORS,
    estimate_esp_range,
    extract_esp_extrema_async,
    find_declared_esp_pair,
    find_mapped_esp_pair,
    resolve_esp_legend_visibility,
    surface_colormap,
    type EspExtremaResult,
    type LegendPosition,
  } from './esp'
  import {
    cube_entries,
    display_range,
    manifest_url,
    plot_export,
    resolve_entry_url,
    resolve_volume_entry_url,
    type ManifestEntry,
    type MultiwfnManifest,
  } from './manifest'
  import {
    ORBITAL_GRID_QUALITY_LEVELS,
    exclusive_volume_visibility,
    initial_orbital_volume_index,
    loaded_orbital_volume_index,
    normalize_orbital_isovalue,
    orbital_frontier_label,
    visible_orbital_index,
  } from './orbital'
  import { clamp_periodic_bound, inject_manifest_lattice } from './periodic'
  import { request_return_and_close } from './return'
  import {
    create_workbench_state,
    download_workbench_state,
    parse_workbench_state,
    restore_workbench_state,
    type MatterVizWorkbenchState,
    type WorkbenchCameraState,
  } from './state'
  import { signal_frontend_ready } from './startup'
  import { AXIS_PRESETS, type SliceAxis, type SliceColormap } from './slice'
  import {
    adapt_matterviz_volume,
    decode_matterviz_volume,
    read_matterviz_volume_response,
  } from './volume'
  import {
    compact_volume_cache,
    orbital_visibility,
    type VolumeCacheOptions,
  } from './volume-cache'
  import { parse_plot, plot_title, read_plot_dataset_response } from './plot'

  let manifest = $state<MultiwfnManifest>({})
  let manifestBase = $state(new URL('/session/', window.location.href))
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
  let surfaceFitPending = false
  $effect(() => { if (topologyActive) surfaceActive = false })
  const open_surface_results = () => {
    if (!surfaceResult) return
    openMenu = undefined; surfacePanelOpen = true; surfaceActive = true
    topologyPanelOpen = false; topologyActive = false; inspectorOpen = false; orbitalPanelOpen = false
  }
  const topologyCell = $derived(manifest.periodic?.enabled && manifest.periodic.cell?.a && manifest.periodic.cell.b && manifest.periodic.cell.c ? [manifest.periodic.cell.a, manifest.periodic.cell.b, manifest.periodic.cell.c] : undefined)
  let loadedManifestUrl = $state(manifest_url())
  let structure = $state<AnyStructure | undefined>()
  let loadedGeometryKey = $state('')
  const geometryKey = $derived(JSON.stringify(structure?.sites.map((site) => site.xyz) ?? []))
  const topologyReason = $derived(loadedGeometryKey && geometryKey !== loadedGeometryKey ? 'The displayed geometry no longer matches the loaded wavefunction' : manifest.topologyAnalysis?.aim?.available === true ? '' : manifest.topologyAnalysis?.aim?.reason || 'The loaded input does not provide AIM wavefunction data')
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
  let displayedStructure = $state<AnyStructure | undefined>()
  let volumetricData = $state<VolumetricData[] | undefined>()
  let volumeEntries = $state<ManifestEntry[]>([])
  let isosurfaceSettings = $state<IsosurfaceSettings>({ ...DEFAULT_ISOSURFACE_SETTINGS })
  let activeVolumeIdx = $state(0)
  let measuredSites = $state<number[]>([])
  let measureMode = $state<MeasureMode>('distance')
  let bondResults = $state<BondResult[]>([])
  let supercellScaling = $state('1x1x1')
  let showImageAtoms = $state(true)
  let showUnitCell = $state(true)
  let showGizmo = $state<boolean | undefined>()
  let latticeProps = $state({
    cell_edge_opacity: 1,
    cell_surface_opacity: 0,
    show_cell_vectors: true,
  })
  let loading = $state(true)
  let structureLoading = $state(false)
  let workingMessage = $state('Loading session...')
  let returnPending = $state(false)
  let errorMessage = $state<string | undefined>()
  let viewerError = $state<string | undefined>()
  let status = $state('Loading Multiwfn session...')
  let orbitalIndex = $state(0)
  let orbitalIsovalue = $state(0.02)
  let orbitalBackendAvailable = $state(true)
  let quality = $state(120000)
  let espIsovalue = $state(0.001)
  let bondMethod = $state('mayer')
  let viewerShell = $state<HTMLElement | undefined>()
  let bondContextMenuElement = $state<HTMLElement | undefined>()
  let bondContextMenu = $state<BondContextMenuState | undefined>()
  let logOpen = $state(false)
  let layerOpen = $state(false)
  let sliceOpen = $state(false)
  let slicePlane = $state<SliceAxis>('xy')
  let sliceMillerH = $state(0)
  let sliceMillerK = $state(0)
  let sliceMillerL = $state(1)
  let slicePosition = $state(0.5)
  let sliceResolution = $state(128)
  let sliceColormap = $state<SliceColormap>('Viridis')
  let sliceRangeMode = $state<'auto' | 'manual'>('auto')
  let sliceManualMin = $state('')
  let sliceManualMax = $state('')
  let espLegendOpen = $state(false)
  let espExtremaOpen = $state(false)
  let espExtremaLoading = $state(false)
  let espExtrema = $state<EspExtremaResult | undefined>()
  let inspectorOpen = $state(true)
  let inspectorSection = $state<'structure' | 'surfaces' | 'cell'>('structure')
  let rotationStep = $state(15)
  let panStep = $state(0.25)
  let zoomStep = $state(10)
  let espRange = $state<[number, number]>([-0.05, 0.05])
  let espLegendPosition = $state<LegendPosition>({ left: 16, top: 16 })
  let stateInput = $state<HTMLInputElement | undefined>()
  let backgroundColor = $state('#ffffff')
  let backgroundOpacity = $state(1)
  let sceneProps = $state<{
    camera_position?: [number, number, number]
    camera_target?: [number, number, number]
    camera_up?: [number, number, number]
    camera_zoom?: number
    camera_projection?: 'perspective' | 'orthographic'
    [key: string]: unknown
  }>({ auto_rotate: 0, camera_control_mode: 'arcball' })
  let logEntries = $state<Array<{ timestamp: string; level: 'info' | 'error'; message: string }>>([])
  let plots = $state<WorkbenchPlot[]>([])
  let activeResult = $state('scene')
  let openMenu = $state<string | undefined>()
  let plotInput: HTMLInputElement
  let resultStage: HTMLDivElement
  let importingPlot = $state(false)
  let savingResult = $state(false)
  let spectrumInput: HTMLInputElement
  let spectrumData = $state.raw<SpectrumData[]>([])
  let spectrumSettings = $state<Record<string, SpectrumSettings>>({})
  let importingSpectrum = $state(false)
  let spectrumBusy = $state(false)
  let spectrumGeneration = 0
  let spectrumGeometryKey: string | undefined
  let spectrumWorkerCancel: (() => void) | undefined
  let spectrumTimer: ReturnType<typeof setTimeout> | undefined
  const spectrumCache = new Map<string, PlotArtifact>()
  const activeSpectrum = $derived(spectrumData.find((data) => activeResult === `spectrum:${data.id}`))
  $effect(() => {
    const key = geometryKey
    if (spectrumGeometryKey !== undefined && key !== spectrumGeometryKey) untrack(reset_spectra)
    spectrumGeometryKey = key
  })
  let orbitalPanelOpen = $state(true)
  let orbitalListElement = $state<HTMLDivElement | undefined>()
  const homoIndex = $derived(manifest.orbitals?.homoIndex ?? manifest.multiwfnGui?.state?.homoIndex)
  let suspendedSpin: unknown
  const active_plot = $derived(plots.find((plot) => plot.id === activeResult))
  const scene_available = $derived(Boolean(structure || volumetricData?.length))

  const stop_spectrum_job = (): void => {
    spectrumGeneration++
    clearTimeout(spectrumTimer)
    spectrumWorkerCancel?.()
    spectrumWorkerCancel = undefined
    spectrumBusy = false
  }
  const reset_spectra = (): void => {
    stop_spectrum_job()
    spectrumData = []; spectrumSettings = {}; spectrumCache.clear(); importingSpectrum = false
    plots = plots.filter((plot) => !plot.id.startsWith('spectrum:'))
    if (activeResult.startsWith('spectrum:')) show_result('scene')
  }
  const spectrum_job = <T,>(message: unknown): Promise<T> => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./spectra.worker.ts', import.meta.url), { type: 'module' })
    const finish = (): void => { worker.terminate(); clearTimeout(timeout); if (spectrumWorkerCancel === cancel) spectrumWorkerCancel = undefined }
    const cancel = (): void => { finish(); reject(new DOMException('Spectrum request superseded', 'AbortError')) }
    const timeout = setTimeout(() => { finish(); reject(new Error('Spectrum processing exceeded 60 seconds')) }, 60000)
    spectrumWorkerCancel = cancel
    worker.onmessage = (event): void => { finish(); if (event.data.ok) resolve(event.data.result as T); else reject(new Error(event.data.message)) }
    worker.onerror = (event): void => { event.preventDefault(); finish(); reject(new Error(event.message || 'Spectrum worker could not start')) }
    worker.postMessage(message)
  })
  const spectrum_reason = (kind: SpectrumKind): string => spectrumData.some((data) => data.kind === kind) || plots.some((plot) => spectrum_kind(plot.artifact) === kind)
    ? '' : `No ${SPECTRUM_NAMES[kind]} data. Import an output containing ${kind === 'uvvis' ? 'excitation energies and oscillator strengths' : kind === 'nmr' ? 'isotropic magnetic shielding tensors' : kind === 'raman' ? 'frequencies and Raman activities' : 'frequencies and IR intensities'}.`
  const build_spectrum = async (data: SpectrumData): Promise<void> => {
    if (importingSpectrum) return
    stop_spectrum_job()
    const generation = spectrumGeneration
    spectrumBusy = true
    const options = $state.snapshot(spectrumSettings[data.id])
    const key = `${data.id}:${JSON.stringify(options)}`
    try {
      const id = `spectrum:${data.id}`
      if (!plots.some((plot) => plot.id === id) && plots.length >= PLOT_RESULT_LIMIT) throw new Error(`Keep at most ${PLOT_RESULT_LIMIT} plots open`)
      const artifact = spectrumCache.get(key) ?? await spectrum_job<PlotArtifact>({ action: 'plot', data, options })
      if (generation !== spectrumGeneration) return
      spectrumCache.set(key, artifact)
      while (spectrumCache.size > 8) spectrumCache.delete(spectrumCache.keys().next().value!)
      plots = [...plots.filter((plot) => plot.id !== id), { id, artifact, resolver: async () => { throw new Error('Spectrum arrays are embedded in the plot') } }]
      show_result(id)
      errorMessage = undefined
      set_status(`${SPECTRUM_NAMES[data.kind]} ready`)
    } catch (error) { if (generation === spectrumGeneration) report_error(error) }
    finally { if (generation === spectrumGeneration) spectrumBusy = false }
  }
  const select_spectrum = (id: string): void => {
    const data = spectrumData.find((item) => item.id === id)
    if (data) void build_spectrum(data)
  }
  const open_spectrum = (kind: SpectrumKind): void => {
    openMenu = undefined
    const existing = plots.find((plot) => plot.id === activeResult && spectrum_kind(plot.artifact) === kind)
    if (existing) { show_result(existing.id); return }
    const data = [...spectrumData].reverse().find((item) => item.kind === kind)
    if (data) { select_spectrum(data.id); return }
    const plot = plots.find((item) => spectrum_kind(item.artifact) === kind)
    if (plot) show_result(plot.id)
  }
  const update_spectrum = (): void => {
    const data = activeSpectrum
    stop_spectrum_job()
    if (data) { spectrumBusy = true; spectrumTimer = setTimeout(() => void build_spectrum(data), 150) }
  }
  const remove_spectrum = (): void => {
    const data = activeSpectrum
    if (!data) return
    stop_spectrum_job()
    spectrumData = spectrumData.filter((item) => item.id !== data.id)
    delete spectrumSettings[data.id]
    for (const key of spectrumCache.keys()) if (key.startsWith(`${data.id}:`)) spectrumCache.delete(key)
    close_plot()
  }
  const import_spectrum_files = async (event: Event): Promise<void> => {
    const input = event.currentTarget as HTMLInputElement
    const files = [...(input.files ?? [])]
    if (!files.length || importingSpectrum) return
    stop_spectrum_job()
    const generation = spectrumGeneration
    importingSpectrum = true; openMenu = undefined
    try {
      if (files.length > 8) throw new Error('Import at most 8 spectrum outputs at once')
      if (files.reduce((sum, file) => sum + file.size, 0) > 128 * 1024 * 1024) throw new Error('A spectrum import group may not exceed 128 MiB')
      const imported: SpectrumData[] = []
      for (const file of files) {
        if (file.size > SPECTRUM_FILE_LIMIT) throw new Error(`${file.name} exceeds the 64 MiB spectrum limit`)
        const text = await file.text()
        if (generation !== spectrumGeneration) return
        const parsed = await spectrum_job<SpectrumData[]>({ action: 'parse', text, name: file.name })
        if (generation !== spectrumGeneration) return
        imported.push(...parsed.map((data) => ({ ...data, id: crypto.randomUUID() })))
      }
      if (spectrumData.length + imported.length > SPECTRUM_DATA_LIMIT) throw new Error(`Keep at most ${SPECTRUM_DATA_LIMIT} spectrum datasets`)
      spectrumData = [...spectrumData, ...imported]
      for (const data of imported) spectrumSettings[data.id] = spectrum_defaults(data.kind)
      errorMessage = undefined
      set_status(`${imported.length} spectrum dataset(s) imported`)
    } catch (error) { if (generation === spectrumGeneration) report_error(error) }
    finally { if (generation === spectrumGeneration) importingSpectrum = false; input.value = '' }
  }

  const show_result = (id: string): void => {
    if (id !== activeResult && !importingSpectrum) stop_spectrum_job()
    if (activeResult === 'scene' && id !== 'scene') {
      suspendedSpin = sceneProps.auto_rotate
      sceneProps = { ...sceneProps, auto_rotate: 0 }
    } else if (id === 'scene' && activeResult !== 'scene' && suspendedSpin !== undefined) {
      sceneProps = { ...sceneProps, auto_rotate: suspendedSpin }
      suspendedSpin = undefined
    }
    activeResult = id
    openMenu = undefined
    close_bond_context_menu()
    layerOpen = false
    logOpen = false
  }

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
      errorMessage = undefined
      set_status(`${imported.length} plot(s) opened`)
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
      if (plot) {
        if (format === 'csv' || format === 'json') {
          const data = format === 'csv' ? await plot_data_csv(plot) : await serialize_plot_document(plot)
          download_blob(new Blob([data], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' }), `${plot_title(plot.artifact)}.${format}`)
        } else {
          const root = resultStage?.querySelector<HTMLElement>('.result-document:not(.inactive) [data-plot-document]')
          if (!root) throw new Error('The active plot is not ready')
          const bytes = await render_plot_document(root, format)
          download_blob(new Blob([bytes.slice().buffer], { type: format === 'svg' ? 'image/svg+xml' : format === 'pdf' ? 'application/pdf' : 'image/png' }), `${plot_title(plot.artifact)}.${format}`)
        }
      } else {
        const canvas = viewerShell?.querySelector<HTMLCanvasElement>('.structure canvas')
        if (!canvas) throw new Error('The 3D scene is not ready')
        const scene = scene_registry.get(canvas)
        if (!scene) throw new Error('The 3D renderer is not ready for export')
        download_blob(await canvas_to_png_blob(canvas, 150, scene.scene, scene.camera), 'Multiwfn-scene.png')
      }
      set_status(`${format.toUpperCase()} exported`)
    } catch (error) { report_error(error) }
    finally { savingResult = false }
  }

  type ApiPayload = {
    topology?: unknown
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

  type BondPair = [number, number]

  type SelectedBondContextDetail = {
    displayed_site_indices: BondPair
    source_site_indices: BondPair
    bond_order?: number | 'aromatic'
    cell_shift?: [number, number, number]
    client_x: number
    client_y: number
  }

  type BondContextMenuState = SelectedBondContextDetail & {
    left: number
    top: number
    max_width: number
    max_height: number
  }

  const CONTEXT_MENU_MARGIN = 8
  let bondContextMenuGeneration = 0

  const valid_bond_pair = (sites: readonly number[]): BondPair | undefined => {
    if (sites.length !== 2) return undefined
    const [first, second] = sites
    if (!Number.isInteger(first) || !Number.isInteger(second) || first < 0 || second < 0 || first === second) {
      return undefined
    }
    return [first, second]
  }

  const valid_source_bond_pair = (sites: readonly number[]): BondPair | undefined => {
    const pair = valid_bond_pair(sites)
    const sourceSiteCount = structure?.sites?.length
    return pair && Number.isInteger(sourceSiteCount) && pair.every((siteIndex) => siteIndex < Number(sourceSiteCount))
      ? pair
      : undefined
  }

  const displayed_source_site_index = (siteIndex: number): number | undefined => {
    const properties = displayedStructure?.sites?.[siteIndex]?.properties
    const sourceIndex = properties?.orig_unit_cell_idx ?? properties?.orig_site_idx ?? siteIndex
    return Number.isInteger(sourceIndex) && Number(sourceIndex) >= 0 ? Number(sourceIndex) : undefined
  }

  const selected_source_bond_pair = (): BondPair | undefined => {
    const displayedPair = valid_bond_pair(measuredSites)
    if (!displayedPair) return undefined
    const first = displayed_source_site_index(displayedPair[0])
    const second = displayed_source_site_index(displayedPair[1])
    return first === undefined || second === undefined ? undefined : valid_source_bond_pair([first, second])
  }

  const same_unordered_pair = (first: BondPair, second: BondPair): boolean =>
    (first[0] === second[0] && first[1] === second[1]) ||
    (first[0] === second[1] && first[1] === second[0])

  const close_bond_context_menu = (): void => {
    bondContextMenuGeneration += 1
    bondContextMenu = undefined
  }

  const context_menu_position = (
    clientX: number,
    clientY: number,
    menuWidth = 260,
    menuHeight = 280,
  ): Pick<BondContextMenuState, 'left' | 'top' | 'max_width' | 'max_height'> => {
    const bounds = viewerShell?.getBoundingClientRect() ?? {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      width: window.innerWidth,
      height: window.innerHeight,
    }
    const maxWidth = Math.max(0, bounds.width - CONTEXT_MENU_MARGIN * 2)
    const maxHeight = Math.max(0, bounds.height - CONTEXT_MENU_MARGIN * 2)
    const renderedWidth = Math.min(menuWidth, maxWidth)
    const renderedHeight = Math.min(menuHeight, maxHeight)
    const minimumLeft = bounds.left + CONTEXT_MENU_MARGIN
    const minimumTop = bounds.top + CONTEXT_MENU_MARGIN
    const maximumLeft = Math.max(minimumLeft, bounds.right - CONTEXT_MENU_MARGIN - renderedWidth)
    const maximumTop = Math.max(minimumTop, bounds.bottom - CONTEXT_MENU_MARGIN - renderedHeight)
    return {
      left: Math.min(maximumLeft, Math.max(minimumLeft, clientX)),
      top: Math.min(maximumTop, Math.max(minimumTop, clientY)),
      max_width: maxWidth,
      max_height: maxHeight,
    }
  }

  const open_bond_context_menu = async (detail: SelectedBondContextDetail): Promise<void> => {
    const displayedPair = valid_bond_pair(detail.displayed_site_indices)
    const sourcePair = valid_source_bond_pair(detail.source_site_indices)
    const currentSelection = valid_bond_pair(measuredSites)
    const methods = manifest.bondAnalysis?.methods
    if (
      !displayedPair ||
      !sourcePair ||
      !currentSelection ||
      !same_unordered_pair(displayedPair, currentSelection) ||
      !methods ||
      Object.keys(methods).length === 0
    ) {
      close_bond_context_menu()
      return
    }
    const generation = bondContextMenuGeneration + 1
    bondContextMenuGeneration = generation
    const clientX = Number.isFinite(detail.client_x) ? detail.client_x : 0
    const clientY = Number.isFinite(detail.client_y) ? detail.client_y : 0
    bondContextMenu = {
      ...detail,
      displayed_site_indices: [...displayedPair],
      source_site_indices: [...sourcePair],
      client_x: clientX,
      client_y: clientY,
      ...context_menu_position(clientX, clientY),
    }
    await tick()
    if (generation !== bondContextMenuGeneration || !bondContextMenu || !bondContextMenuElement) return
    const position = context_menu_position(
      clientX,
      clientY,
      bondContextMenuElement.offsetWidth,
      bondContextMenuElement.offsetHeight,
    )
    bondContextMenu = { ...bondContextMenu, ...position }
    await tick()
    const firstAvailableMethod = bondContextMenuElement?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    if (firstAvailableMethod) firstAvailableMethod.focus()
    else bondContextMenuElement?.focus()
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

  const add_log = (message: string, level: 'info' | 'error' = 'info'): void => {
    logEntries = [...logEntries, { timestamp: new Date().toLocaleTimeString(), level, message }]
  }

  const set_status = (message: string): void => {
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

  const fetch_text = async (url: URL): Promise<string> => {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) throw new Error(`${url.pathname}: HTTP ${response.status}`)
    return response.text()
  }

  const layer_for_entry = (entry: ManifestEntry, volume_idx: number): IsosurfaceLayer => {
    const signed = entry.mode === 'signed' || entry.role === 'orbital'
    const espPotential = entry.analysisKind === 'esp-potential'
    return {
      isovalue: Math.abs(Number(entry.isovalue ?? (signed ? 0.02 : 0.001))),
      color: espPotential ? ESP_COLORS.positive : signed ? '#2563eb' : '#9ca3af',
      negative_color: espPotential ? ESP_COLORS.negative : '#dc2626',
      opacity: Number(entry.opacity ?? 0.82),
      visible: entry.visible !== false,
      show_negative: signed,
      volume_idx,
    }
  }

  const parse_volume_entry = async (
    entry: ManifestEntry,
    base: URL,
  ): Promise<{ structure?: AnyStructure; volumes: VolumetricData[] }> => {
    if (entry.format === 'mwfn-volume-v1') {
      const url = resolve_volume_entry_url(entry, base)
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) throw new Error(`${url.pathname}: HTTP ${response.status}`)
      const contentType = response.headers.get('content-type') || ''
      if (!contentType.includes('application/vnd.multiwfn.volume')) {
        throw new Error(`${url.pathname}: expected a MatterViz binary volume`)
      }
      const volume = adapt_matterviz_volume(
        decode_matterviz_volume(await response.arrayBuffer()),
      )
      return {
        volumes: [{
          ...volume,
          label: entry.name || entry.role || 'Volume',
          source: entry.path,
        }],
      }
    }
    const text = await fetch_text(resolve_entry_url(entry, base))
    const parsed = parse_volumetric_file(text, entry.path)
    if (!parsed) throw new Error(`MatterViz could not parse ${entry.path}`)
    const volumes = parsed.volumes.map((volume, idx) => ({
      ...volume,
      ...(manifest.structure?.path ? { origin_mode: 'absolute' as const } : {}),
      label: entry.name || `${entry.role || 'Volume'} ${idx + 1}`,
      source: entry.path,
    }))
    return { structure: parsed.structure, volumes }
  }

  const apply_entries = async (
    entries: ManifestEntry[],
    base: URL,
    mode: 'replace' | 'append' = 'replace',
  ): Promise<number> => {
    const parsed = await Promise.all(entries.map((entry) => parse_volume_entry(entry, base)))
    const volumes = parsed.flatMap((item) => item.volumes)
    const expandedEntries = entries.flatMap((entry, idx) => parsed[idx].volumes.map(() => entry))
    const previousVolumes = mode === 'append' ? (volumetricData ?? []) : []
    const nextVolumes = [...previousVolumes, ...volumes]
    if (!structure) {
      const parsedStructureIdx = parsed.findIndex((item) => item.structure)
      const parsedStructure = parsed[parsedStructureIdx]?.structure
      if (parsedStructure) {
        structure = inject_manifest_lattice(parsedStructure, manifest, { override: true })
      }
    }
    const previousLayers = mode === 'append' ? (isosurfaceSettings.layers ?? []) : []
    const firstVolumeIdx = previousVolumes.length
    volumetricData = nextVolumes
    volumeEntries = mode === 'append' ? [...volumeEntries, ...expandedEntries] : expandedEntries
    isosurfaceSettings = {
      ...(mode === 'append' ? isosurfaceSettings : DEFAULT_ISOSURFACE_SETTINGS),
      display_range: display_range(manifest),
      layers: [...previousLayers, ...entries.flatMap((entry, idx) =>
        parsed[idx].volumes.map((_, local_idx) =>
          layer_for_entry(
            entry,
            firstVolumeIdx + parsed.slice(0, idx).reduce((sum, item) => sum + item.volumes.length, 0) + local_idx,
          ),
        ),
      )],
    }
    activeVolumeIdx = firstVolumeIdx
    return firstVolumeIdx
  }

  const compact_volumes = (options: VolumeCacheOptions = {}): Map<number, number> => {
    const compacted = compact_volume_cache({
      volumes: volumetricData ?? [],
      entries: volumeEntries,
      layers: isosurfaceSettings.layers ?? [],
      active_volume_idx: activeVolumeIdx,
    }, options)
    volumetricData = compacted.volumes
    volumeEntries = compacted.entries
    isosurfaceSettings = { ...isosurfaceSettings, layers: compacted.layers }
    activeVolumeIdx = compacted.active_volume_idx
    if (!esp_pair()) clear_esp_tools()
    return compacted.old_to_new
  }

  const remove_volumes = (predicate: (entry: ManifestEntry, index: number) => boolean): void => {
    const remove_indices = volumeEntries.flatMap((entry, index) => predicate(entry, index) ? [index] : [])
    compact_volumes({ remove_indices })
  }

  const remove_volume = (volumeIdx: number): void => {
    const target = volumeEntries[volumeIdx]
    if (!target) return
    remove_volumes((_entry, index) => index === volumeIdx)
    set_status(`${target.name || target.role || 'Volume'} removed`)
  }

  const activate_only_volume = (volumeIdx: number | undefined): void => {
    isosurfaceSettings = {
      ...isosurfaceSettings,
      layers: exclusive_volume_visibility(isosurfaceSettings.layers ?? [], volumeIdx),
    }
    if (volumeIdx !== undefined) activeVolumeIdx = volumeIdx
  }

  const activate_orbital_volume = (volumeIdx: number | undefined): number | undefined => {
    isosurfaceSettings = {
      ...isosurfaceSettings,
      layers: orbital_visibility(isosurfaceSettings.layers ?? [], volumeEntries, volumeIdx),
    }
    if (volumeIdx !== undefined) activeVolumeIdx = volumeIdx
    const oldToNew = compact_volumes({ retain_active_volume: volumeIdx !== undefined })
    return volumeIdx === undefined ? undefined : oldToNew.get(volumeIdx)
  }

  const restore_visible_orbital_selection = (): void => {
    orbitalIndex = visible_orbital_index(volumeEntries, isosurfaceSettings.layers ?? []) ?? 0
  }

  const active_volume_bytes = (): number => {
    const buffers = new Set<ArrayBufferLike>()
    let bytes = 0
    for (const volume of volumetricData ?? []) {
      if (Array.isArray(volume.grid)) continue
      const buffer = volume.grid.data.buffer
      if (buffers.has(buffer)) continue
      buffers.add(buffer)
      bytes += buffer.byteLength
      if (!Number.isSafeInteger(bytes)) return Number.MAX_SAFE_INTEGER
    }
    return bytes
  }

  const replace_volume_entry = async (
    volumeIdx: number,
    entry: ManifestEntry,
    base: URL,
  ): Promise<number> => {
    const parsed = await parse_volume_entry(entry, base)
    if (parsed.volumes.length !== 1) {
      remove_volumes((_entry, index) => index === volumeIdx)
      return apply_entries([entry], base, 'append')
    }
    if (!structure && parsed.structure) {
      structure = inject_manifest_lattice(parsed.structure, manifest, { override: true })
    }
    const volumes = [...(volumetricData ?? [])]
    volumes[volumeIdx] = parsed.volumes[0]
    volumetricData = volumes
    volumeEntries = volumeEntries.map((current, index) => index === volumeIdx ? entry : current)
    isosurfaceSettings = {
      ...isosurfaceSettings,
      layers: (isosurfaceSettings.layers ?? []).map((layer) =>
        layer.volume_idx === volumeIdx ? layer_for_entry(entry, volumeIdx) : layer),
    }
    return volumeIdx
  }

  const upsert_loaded_volume = (
    volumeIdx: number | undefined,
    entry: ManifestEntry,
    volume: VolumetricData,
  ): number => {
    if (volumeIdx === undefined) {
      const nextIdx = volumetricData?.length ?? 0
      volumetricData = [...(volumetricData ?? []), volume]
      volumeEntries = [...volumeEntries, entry]
      isosurfaceSettings = {
        ...isosurfaceSettings,
        layers: [...(isosurfaceSettings.layers ?? []), layer_for_entry(entry, nextIdx)],
      }
      return nextIdx
    }
    const volumes = [...(volumetricData ?? [])]
    volumes[volumeIdx] = volume
    volumetricData = volumes
    volumeEntries = volumeEntries.map((current, index) => index === volumeIdx ? entry : current)
    isosurfaceSettings = {
      ...isosurfaceSettings,
      layers: (isosurfaceSettings.layers ?? []).map((layer) =>
        layer.volume_idx === volumeIdx ? layer_for_entry(entry, volumeIdx) : layer),
    }
    return volumeIdx
  }

  const update_layer = (volumeIdx: number, patch: Partial<IsosurfaceLayer>): void => {
    const layers = isosurfaceSettings.layers ?? []
    isosurfaceSettings = {
      ...isosurfaceSettings,
      layers: layers.map((layer) => layer.volume_idx === volumeIdx ? { ...layer, ...patch } : layer),
    }
  }

  const set_color_range = (volumeIdx: number, bound: 0 | 1, value: number): void => {
    if (!Number.isFinite(value)) return
    const layer = (isosurfaceSettings.layers ?? []).find((item) => item.volume_idx === volumeIdx)
    const [lower, upper] = layer?.color_range ?? [-0.05, 0.05]
    update_layer(volumeIdx, {
      color_range: bound === 0
        ? [Math.min(value, upper), upper]
        : [lower, Math.max(value, lower)],
    })
  }

  const set_color_volume = (volumeIdx: number, colorVolumeIdx: number): void => {
    if (colorVolumeIdx < 0) {
      update_layer(volumeIdx, { color_volume_idx: undefined, colormap: undefined, color_range: undefined })
      if (!esp_pair()) clear_esp_tools()
      return
    }
    const colorVolume = volumetricData?.[colorVolumeIdx]
    const surfaceVolume = volumetricData?.[volumeIdx]
    if (!colorVolume || !surfaceVolume) return
    const compatibility = compare_volume_grids(surfaceVolume, colorVolume)
    if (!compatibility.ok) {
      report_error(new Error(`Color grid is incompatible: ${compatibility.reason || 'grid mismatch'}`))
      return
    }
    const color = auto_color_config(colorVolume.data_range)
    update_layer(volumeIdx, {
      color_volume_idx: colorVolumeIdx,
      colormap: surface_colormap(volumeEntries[colorVolumeIdx], color.colormap),
      color_range: color.color_range,
    })
    if (!esp_pair()) clear_esp_tools()
  }

  const grids_compatible = (leftIdx: number, rightIdx: number): boolean => {
    const left = volumetricData?.[leftIdx]
    const right = volumetricData?.[rightIdx]
    return Boolean(left && right && compare_volume_grids(left, right).ok)
  }

  const esp_pair = (): { densityIdx: number; potentialIdx: number } | undefined => {
    return find_mapped_esp_pair(volumeEntries, isosurfaceSettings.layers ?? [], grids_compatible)
  }

  const declared_esp_pair = (): { densityIdx: number; potentialIdx: number } | undefined =>
    find_declared_esp_pair(volumeEntries, grids_compatible)

  const clear_esp_tools = (): void => {
    espLegendOpen = false
    espExtremaOpen = false
    espExtrema = undefined
  }

  const refresh_esp_range = (densityIdx: number, potentialIdx: number): void => {
    const density = volumetricData?.[densityIdx]
    const potential = volumetricData?.[potentialIdx]
    if (!density || !potential) return
    const range = estimate_esp_range(density, potential, espIsovalue, { maxCells: 150000, maxSamples: 50000 })
    espRange = [range.min, range.max]
    update_layer(densityIdx, { color_range: espRange })
  }

  const linked_esp_range = (): [number, number] | undefined => {
    const pair = esp_pair()
    if (!pair) return undefined
    const layer = (isosurfaceSettings.layers ?? []).find((item) => item.volume_idx === pair.densityIdx)
    const range = layer?.color_range
    if (!Array.isArray(range) || range.length < 2) return undefined
    const lower = Number(range[0])
    const upper = Number(range[1])
    if (!Number.isFinite(lower) || !Number.isFinite(upper)) return undefined
    return lower <= upper ? [lower, upper] : [upper, lower]
  }

  const current_esp_range = (): [number, number] => linked_esp_range() ?? espRange

  const state_url = (): URL | undefined => {
    const value = new URL(window.location.href).searchParams.get('state')
    return value ? new URL(value, window.location.href) : undefined
  }

  const fetch_workbench_state = async (url: URL): Promise<MatterVizWorkbenchState> => {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) throw new Error(`Workbench state request returned HTTP ${response.status}`)
    return parse_workbench_state(await response.json())
  }

  const apply_workbench_state = (state: MatterVizWorkbenchState): void => {
    const restored = restore_workbench_state(state, { entries: volumeEntries, isosurfaceSettings })
    const layers = (restored.isosurfaceSettings.layers ?? []).map((layer) => {
      const volumeIdx = layer.volume_idx ?? 0
      const colorIdx = layer.color_volume_idx
      if (colorIdx === undefined || grids_compatible(volumeIdx, colorIdx)) return layer
      add_log(`Ignored incompatible restored color grid for volume ${volumeIdx + 1}`, 'error')
      return { ...layer, color_volume_idx: undefined, colormap: undefined, color_range: undefined }
    })
    isosurfaceSettings = { ...restored.isosurfaceSettings, layers }
    activeVolumeIdx = restored.activeVolume
    const activeLayer = layers.find((layer) => (layer.volume_idx ?? 0) === activeVolumeIdx)
    const activeOrbitalIndex = Number(volumeEntries[activeVolumeIdx]?.orbitalIndex)
    orbitalIndex = activeLayer?.visible !== false && Number.isInteger(activeOrbitalIndex) && activeOrbitalIndex > 0
      ? activeOrbitalIndex
      : 0
    if (restored.periodic) {
      if (restored.periodic.displayRange) {
        isosurfaceSettings = { ...isosurfaceSettings, display_range: restored.periodic.displayRange }
      }
      supercellScaling = restored.periodic.atomSupercell
      showImageAtoms = restored.periodic.showBoundaryAtoms
      showUnitCell = restored.periodic.showUnitCell
      latticeProps = {
        ...latticeProps,
        cell_edge_opacity: showUnitCell ? 1 : 0,
        show_cell_vectors: showUnitCell,
      }
    }
    if (restored.camera) {
      sceneProps = {
        ...sceneProps,
        ...(restored.camera.position ? { camera_position: [...restored.camera.position] as [number, number, number] } : {}),
        ...(restored.camera.target ? { camera_target: [...restored.camera.target] as [number, number, number] } : {}),
        ...(restored.camera.up ? { camera_up: [...restored.camera.up] as [number, number, number] } : {}),
        ...(restored.camera.zoom !== undefined ? { camera_zoom: restored.camera.zoom } : {}),
        ...(restored.camera.projection ? { camera_projection: restored.camera.projection } : {}),
      }
    }
    if (restored.structureAppearance) {
      const appearance = restored.structureAppearance
      sceneProps = {
        ...sceneProps,
        ...(appearance.representationPreset !== undefined ? { representation_preset: appearance.representationPreset } : {}),
        ...(appearance.representationAtomBase !== undefined ? { representation_atom_base: appearance.representationAtomBase } : {}),
        ...(appearance.representationBondBase !== undefined ? { representation_bond_base: appearance.representationBondBase } : {}),
        ...(appearance.showAtoms !== undefined ? { show_atoms: appearance.showAtoms } : {}),
        ...(appearance.showBonds !== undefined ? { show_bonds: appearance.showBonds } : {}),
        ...(appearance.showGizmo !== undefined ? { show_gizmo: appearance.showGizmo } : {}),
        ...(appearance.atomRadius !== undefined ? { atom_radius: appearance.atomRadius } : {}),
        ...(appearance.sameSizeAtoms !== undefined ? { same_size_atoms: appearance.sameSizeAtoms } : {}),
        ...(appearance.bondThickness !== undefined ? { bond_thickness: appearance.bondThickness } : {}),
        ...(appearance.bondingStrategy !== undefined ? { bonding_strategy: appearance.bondingStrategy } : {}),
        ...(appearance.showSiteLabels !== undefined ? { show_site_labels: appearance.showSiteLabels } : {}),
        ...(appearance.showSiteIndices !== undefined ? { show_site_indices: appearance.showSiteIndices } : {}),
        ...(appearance.sphereSegments !== undefined ? { sphere_segments: appearance.sphereSegments } : {}),
      }
      if (appearance.showGizmo !== undefined) showGizmo = appearance.showGizmo
      if (appearance.backgroundColor !== undefined) backgroundColor = appearance.backgroundColor
      if (appearance.backgroundOpacity !== undefined) backgroundOpacity = appearance.backgroundOpacity
    }
    const slice = restored.slice
    sliceOpen = slice?.open ?? false
    slicePlane = slice?.plane ?? 'xy'
    const millerIndices = slice?.millerIndices ?? AXIS_PRESETS[slicePlane]
    sliceMillerH = millerIndices[0]
    sliceMillerK = millerIndices[1]
    sliceMillerL = millerIndices[2]
    slicePosition = slice?.position ?? 0.5
    sliceResolution = slice?.resolution ?? 128
    sliceColormap = slice?.colormap ?? 'Viridis'
    sliceRangeMode = slice?.rangeMode ?? 'auto'
    sliceManualMin = slice?.manualMin === undefined ? '' : String(slice.manualMin)
    sliceManualMax = slice?.manualMax === undefined ? '' : String(slice.manualMax)
    espLegendOpen = resolve_esp_legend_visibility(restored.espLegend?.visible, esp_pair())
    espLegendPosition = restored.espLegend?.position ?? { left: 16, top: 16 }
    if (restored.topologyDisplay) topologyDisplay = restored.topologyDisplay
    const restoredEspRange = linked_esp_range()
    if (restoredEspRange) espRange = restoredEspRange
    set_status('MatterViz workbench state restored')
    add_log('Workbench state restored')
  }

  const load_structure = async (): Promise<void> => {
    const entry = manifest.structure
    if (!entry?.path) return
    const text = await fetch_text(resolve_entry_url(entry, manifestBase))
    const loaded = inject_manifest_lattice(parse_any_structure(text, entry.path), manifest, { override: true })
    structure = loaded
    loadedGeometryKey = JSON.stringify(loaded.sites.map((site) => site.xyz))
  }

  const load_manifest = async (): Promise<void> => {
    reset_spectra()
    topologyGeneration++
    const generation = topologyGeneration
    surfaceResult = undefined
    surfaceActive = false
    surfacePanelOpen = false
    surfaceSelection = undefined
    surfaceDisplay = surface_display_defaults()
    loadedGeometryKey = ''
    topologyResult = undefined
    topologyActive = false
    topologySelection = undefined
    loading = true
    errorMessage = undefined
    try {
      const startupStateUrl = state_url()
      let startupState: MatterVizWorkbenchState | undefined
      if (startupStateUrl) startupState = await fetch_workbench_state(startupStateUrl)
      const pageUrl = new URL(window.location.href)
      const url = !pageUrl.searchParams.has('manifest') && startupState?.sourceManifest
        ? new URL(startupState.sourceManifest, startupStateUrl)
        : manifest_url()
      loadedManifestUrl = url
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) throw new Error(`Manifest request returned HTTP ${response.status}`)
      manifest = (await response.json()) as MultiwfnManifest
      const inlinePlot = (manifest as MultiwfnManifest & { plot?: unknown }).plot
      if (inlinePlot !== undefined) {
        plots = [{ id: 'native', native: true, artifact: parse_plot(inlinePlot),
          resolver: cached_plot_resolver(async (datasetId) => {
            const response = await fetch(api_url(`/api/plot-data/${datasetId}`), { cache: 'no-store' })
            return read_plot_dataset_response(response, datasetId)
          }),
        }]
        activeResult = 'native'
        manifestBase = new URL('.', url)
        set_status(plot_title(plots[0].artifact))
        await signal_frontend_ready()
        loading = false
        return
      }
      manifestBase = new URL('.', url)
      quality = Number(manifest.espAnalysis?.defaultQuality ?? 120000)
      orbitalIsovalue = normalize_orbital_isovalue(manifest.multiwfnGui?.state?.sur_value_orb, 0.02)
      orbitalBackendAvailable = true
      espIsovalue = Number(manifest.espAnalysis?.defaultIsovalue ?? 0.001)
      orbitalIndex = Number(manifest.orbitals?.homoIndex ?? manifest.multiwfnGui?.state?.homoIndex ?? 0)
      if (manifest.multiwfnGui?.state?.showMolecule !== undefined) {
        sceneProps = {
          ...sceneProps,
          show_atoms: manifest.multiwfnGui.state.showMolecule,
          ...(!manifest.multiwfnGui.state.showMolecule ? { show_bonds: 'never' } : {}),
        }
      }
      showUnitCell = manifest.periodic?.showUnitCell !== false
      latticeProps = {
        ...latticeProps,
        cell_edge_opacity: showUnitCell ? 1 : 0,
        show_cell_vectors: showUnitCell,
      }
      const availableBondMethod = Object.entries(manifest.bondAnalysis?.methods ?? {})
        .find(([, capability]) => capability.available !== false)?.[0]
      if (availableBondMethod) bondMethod = availableBondMethod
      const entries = cube_entries(manifest)
      if (manifest.structure?.path) await load_structure()
      if (entries.length) await apply_entries(entries, manifestBase)
      if (manifest.topology) {
        topologyResult = await load_topology(manifest.topology)
        topologyActive = true
        topologyPanelOpen = true
        orbitalPanelOpen = false
      }
      if (manifest.surfaceAnalysis) {
        const result = await resolve_surface(manifest.surfaceAnalysis, async (datasetId) => {
          const response = await fetch(api_url(`/api/plot-data/${datasetId}`), { cache: 'no-store' })
          return read_plot_dataset_response(response, datasetId)
        })
        if (generation !== topologyGeneration) return
        surfaceResult = result
        surfaceFitPending = true
        open_surface_results()
      }
      if (String(manifest.multiwfnGui?.entry || '').toLowerCase().includes('drawmol')) {
        const initialVolumeIdx = initial_orbital_volume_index(
          volumeEntries,
          manifest.orbitals?.homoIndex ?? manifest.multiwfnGui?.state?.homoIndex,
        )
        activate_only_volume(initialVolumeIdx)
        const activeOrbitalIndex = initialVolumeIdx === undefined
          ? undefined
          : Number(volumeEntries[initialVolumeIdx]?.orbitalIndex)
        if (Number.isInteger(activeOrbitalIndex) && Number(activeOrbitalIndex) > 0) {
          orbitalIndex = Number(activeOrbitalIndex)
        }
      }
      const initialEsp = declared_esp_pair()
      if (initialEsp) {
        set_color_volume(initialEsp.densityIdx, initialEsp.potentialIdx)
        update_layer(initialEsp.potentialIdx, { visible: false })
        refresh_esp_range(initialEsp.densityIdx, initialEsp.potentialIdx)
        espLegendOpen = true
      }
      set_status(surfaceResult ? 'Original quantitative surface results loaded' : entries.length ? `${entries.length} volume layer(s) loaded` : 'Structure loaded')
      if (startupState) apply_workbench_state(startupState)
      await signal_frontend_ready()
    } catch (error) {
      report_error(error)
      status = 'Session loading failed'
    } finally {
      loading = false
    }
  }

  const request_orbital = async (options: { forceRecompute?: boolean } = {}): Promise<void> => {
    if (loading || structureLoading) return
    const requestedIndex = orbitalIndex
    if (requestedIndex === 0) {
      errorMessage = undefined
      activate_orbital_volume(undefined)
      set_status('No orbital selected')
      topologyActive = false
      surfaceActive = false
      return
    }
    if (!Number.isInteger(requestedIndex) || requestedIndex < 1 || requestedIndex > orbital_count()) {
      report_error(new Error(`Orbital index must be an integer from 1 to ${orbital_count()}`))
      return
    }
    errorMessage = undefined
    const cachedVolumeIdx = loaded_orbital_volume_index(volumeEntries, requestedIndex)
    if (cachedVolumeIdx !== undefined && !options.forceRecompute) {
      activate_orbital_volume(cachedVolumeIdx)
      set_status(`Orbital ${requestedIndex} loaded from session cache`)
      topologyActive = false
      surfaceActive = false
      return
    }
    const requestedQuality = quality
    if (!orbitalBackendAvailable) {
      report_error(new Error('This orbital session is no longer connected to Multiwfn; reopen menu 0 to calculate another orbital'))
      return
    }
    loading = true
    workingMessage = `Calculating orbital ${requestedIndex}...`
    add_log(`Requesting orbital ${requestedIndex} at grid quality ${requestedQuality}`)
    try {
      if (cachedVolumeIdx === undefined) activate_orbital_volume(undefined)
      const params = new URLSearchParams({
        index: String(requestedIndex),
        quality: String(requestedQuality),
        isovalue: String(orbitalIsovalue),
        activeVolumeBytes: String(active_volume_bytes()),
      })
      const response = await fetch(api_url('/api/orbital', params), { cache: 'no-store' })
      const contentType = response.headers.get('content-type') || ''
      let activeIdx: number
      if (response.ok && contentType.includes('application/vnd.multiwfn.volume')) {
        const geometryBudget = Number(
          response.headers.get('x-matterviz-geometry-memory-budget'),
        )
        if (!Number.isSafeInteger(geometryBudget) || geometryBudget < 0) {
          throw new Error('Multiwfn returned an invalid geometry memory budget')
        }
        const decoded = decode_matterviz_volume(await read_matterviz_volume_response(response))
        if (decoded.protocol_major !== 2 || decoded.quantity_kind !== 'orbital') {
          throw new Error('Multiwfn returned an unexpected volume for the orbital request')
        }
        const layer: ManifestEntry = {
          name: `Orbital ${requestedIndex}`,
          path: '/api/orbital',
          format: 'mwfn-volume-v2',
          role: 'orbital',
          mode: 'signed',
          orbitalIndex: requestedIndex,
          gridQuality: requestedQuality,
          isovalue: orbitalIsovalue,
          visible: true,
        }
        const volume = {
          ...adapt_matterviz_volume(decoded),
          label: layer.name,
          source: layer.path,
        }
        isosurfaceSettings = {
          ...isosurfaceSettings,
          geometry_memory_budget_bytes: geometryBudget,
        }
        activeIdx = upsert_loaded_volume(cachedVolumeIdx, layer, volume)
      } else {
        const payload = await read_api_payload(response)
        if (!response.ok || !payload.ok || !payload.layer) {
          throw new Error(payload.message || 'Orbital calculation failed')
        }
        const layer = {
          ...payload.layer,
          role: 'orbital',
          orbitalIndex: requestedIndex,
          gridQuality: Number(payload.quality ?? requestedQuality),
          isovalue: Number(payload.isovalue ?? payload.layer.isovalue ?? orbitalIsovalue),
        }
        activeIdx = cachedVolumeIdx === undefined
          ? await apply_entries([layer], manifestBase, 'append')
          : await replace_volume_entry(cachedVolumeIdx, layer, manifestBase)
      }
      orbitalIndex = requestedIndex
      orbitalBackendAvailable = true
      activate_orbital_volume(activeIdx)
      topologyActive = false
      surfaceActive = false
      set_status(`Orbital ${requestedIndex} loaded`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('Multiwfn backend unavailable')) orbitalBackendAvailable = false
      restore_visible_orbital_selection()
      report_error(error)
    } finally {
      loading = false
    }
  }

  const change_orbital_quality = async (event: Event): Promise<void> => {
    const nextQuality = Number((event.currentTarget as HTMLSelectElement).value)
    if (!Number.isFinite(nextQuality)) return
    quality = nextQuality
    if (orbital_index_valid()) await request_orbital({ forceRecompute: true })
  }

  const change_orbital_isovalue = (value: unknown): void => {
    orbitalIsovalue = normalize_orbital_isovalue(value, orbitalIsovalue)
    const activeIdx = loaded_orbital_volume_index(volumeEntries, orbitalIndex)
    if (activeIdx !== undefined) update_layer(activeIdx, { isovalue: orbitalIsovalue })
  }

  const request_esp = async (): Promise<void> => {
    if (loading || structureLoading) return
    loading = true
    workingMessage = 'Calculating ESP...'
    errorMessage = undefined
    add_log(`Requesting ESP surface at grid quality ${quality}, density isovalue ${espIsovalue}`)
    try {
      const params = new URLSearchParams({
        quality: String(quality),
        isovalue: String(espIsovalue),
      })
      const response = await fetch(api_url('/api/esp', params), { cache: 'no-store' })
      const payload = await read_api_payload(response)
      if (!response.ok || !payload.ok || !payload.densityLayer || !payload.espLayer) {
        throw new Error(payload.message || 'ESP calculation failed')
      }
      workingMessage = 'Loading ESP surfaces...'
      remove_volumes((entry) => entry.analysisKind === 'esp-density' || entry.analysisKind === 'esp-potential')
      const entries: ManifestEntry[] = [payload.densityLayer, payload.espLayer]
      const firstVolumeIdx = await apply_entries(entries, manifestBase, 'append')
      const volumes = volumetricData ?? []
      if (volumes.length >= firstVolumeIdx + 2) {
        set_color_volume(firstVolumeIdx, firstVolumeIdx + 1)
        update_layer(firstVolumeIdx + 1, { visible: false })
        refresh_esp_range(firstVolumeIdx, firstVolumeIdx + 1)
        espLegendOpen = true
        espExtrema = undefined
      }
      set_status('ESP mapped onto the electron-density surface')
      topologyActive = false
      surfaceActive = false
    } catch (error) {
      report_error(error)
    } finally {
      loading = false
    }
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
    workingMessage = 'Calculating AIM critical points and paths...'
    errorMessage = undefined
    add_log('Starting AIM critical-point search and path generation')
    try {
      const params = new URLSearchParams(Object.entries(topologyOptions).map(([key, value]) => [key, String(value)]))
      const response = await fetch(api_url('/api/topology', params), { cache: 'no-store' })
      const payload = await read_api_payload(response)
      if (generation !== topologyGeneration || geometry !== geometryKey) return
      if (!response.ok || !payload.ok || !payload.topology) throw new Error(payload.message || 'AIM calculation failed')
      workingMessage = 'Loading topology coordinates...'
      const result = await load_topology(payload.topology)
      if (generation !== topologyGeneration || geometry !== geometryKey) return
      topologyResult = result
      surfaceActive = false
      surfacePanelOpen = false
      topologySelection = undefined
      topologyActive = true
      topologyPanelOpen = true
      activeResult = 'scene'
      set_status(`AIM: ${result.metadata.criticalPoints.length} critical points, ${result.metadata.paths.length} paths`)
      add_log(`AIM finished: N-B+R-C = ${result.metadata.eulerCount}; unconnected path directions: ${result.metadata.missingPathDirections}`)
    } catch (error) {
      if (generation === topologyGeneration && geometry === geometryKey) report_error(error)
    } finally {
      loading = false
    }
  }

  const export_topology = (format: 'json' | 'csv'): void => {
    if (!topologyResult) return
    const text = format === 'json' ? topology_document(topologyResult) : topology_csv(topologyResult)
    download_blob(new Blob([text], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' }), `Multiwfn-topology.${format}`)
  }
  const export_surface = (format: 'json' | 'csv'): void => {
    if (!surfaceResult) return
    const text = format === 'json' ? surface_document(surfaceResult) : surface_csv(surfaceResult)
    download_blob(new Blob([text], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' }), `Multiwfn-quantitative-surface.${format}`)
  }

  const request_bond = async (options: { method?: string; pair?: BondPair } = {}): Promise<void> => {
    if (loading || structureLoading) return
    const selected = options.pair ? valid_source_bond_pair(options.pair) : selected_source_bond_pair()
    if (!selected) {
      report_error(new Error('Select two atoms with the MatterViz measurement tool'))
      return
    }
    const method = options.method ?? bondMethod
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
    errorMessage = undefined
    const atom1 = selected[0] + 1
    const atom2 = selected[1] + 1
    const sourceStructure = structure
    workingMessage = `Calculating ${bond_method_label(method)} bond order...`
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

  const request_context_bond = async (method: string): Promise<void> => {
    const menu = bondContextMenu
    const pair = menu ? valid_source_bond_pair(menu.source_site_indices) : undefined
    if (!pair || unavailable_bond_method_reason(method)) return
    close_bond_context_menu()
    bondMethod = method
    await request_bond({ method, pair: [...pair] })
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
      onReturned: () => set_status('Returning to Multiwfn...'),
      onError: report_error,
    })
    returnPending = false
  }

  const copy_log = async (): Promise<void> => {
    const text = logEntries.map((entry) => `[${entry.timestamp}] ${entry.level.toUpperCase()} ${entry.message}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      set_status('Log copied to clipboard')
    } catch (error) {
      report_error(error)
    }
  }

  const calculate_esp_extrema = async (): Promise<void> => {
    const pair = esp_pair()
    if (!pair) {
      report_error(new Error('No compatible ESP-colored density surface is available'))
      return
    }
    const density = volumetricData?.[pair.densityIdx]
    const potential = volumetricData?.[pair.potentialIdx]
    if (!density || !potential) return
    espExtremaLoading = true
    espExtremaOpen = true
    try {
      espExtrema = await extract_esp_extrema_async(density, potential, espIsovalue, {
        maxCells: 120000,
        maxSamples: 50000,
        maxExtrema: 12,
        excludeBoundary: true,
      })
      set_status(`${espExtrema.minima.length} approximate ESP minima and ${espExtrema.maxima.length} maxima found`)
    } catch (error) {
      report_error(error)
    } finally {
      espExtremaLoading = false
    }
  }

  const export_state = (): void => {
    const camera: WorkbenchCameraState = {
      position: sceneProps.camera_position,
      target: sceneProps.camera_target,
      up: sceneProps.camera_up,
      zoom: sceneProps.camera_zoom,
      projection: sceneProps.camera_projection,
    }
    download_workbench_state(create_workbench_state({
      manifest,
      sourceManifest: loadedManifestUrl.href,
      entries: volumeEntries,
      isosurfaceSettings,
      activeVolume: activeVolumeIdx,
      atomSupercell: supercellScaling,
      showBoundaryAtoms: showImageAtoms,
      showUnitCell,
      camera,
      sceneProps,
      backgroundColor,
      backgroundOpacity,
      slice: {
        open: sliceOpen,
        plane: slicePlane,
        millerIndices: [sliceMillerH, sliceMillerK, sliceMillerL],
        position: slicePosition,
        resolution: sliceResolution,
        colormap: sliceColormap,
        rangeMode: sliceRangeMode,
        ...(Number.isFinite(Number(sliceManualMin)) && sliceManualMin.trim() !== '' ? { manualMin: Number(sliceManualMin) } : {}),
        ...(Number.isFinite(Number(sliceManualMax)) && sliceManualMax.trim() !== '' ? { manualMax: Number(sliceManualMax) } : {}),
      },
      espLegend: { visible: espLegendOpen, position: espLegendPosition },
      topologyDisplay,
    }))
    set_status('MatterViz workbench state exported')
  }

  const import_state_file = async (event: Event): Promise<void> => {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    try {
      apply_workbench_state(parse_workbench_state(JSON.parse(await file.text())))
    } catch (error) {
      report_error(error)
    } finally {
      input.value = ''
    }
  }

  const track_camera = (data: {
    camera_position?: [number, number, number]
    camera_target?: [number, number, number]
    camera_up?: [number, number, number]
    camera_zoom?: number
  }): void => {
    if (camera_update_matches(sceneProps, data)) return
    sceneProps = {
      ...sceneProps,
      ...(data.camera_position ? { camera_position: [...data.camera_position] as [number, number, number] } : {}),
      ...(data.camera_target ? { camera_target: [...data.camera_target] as [number, number, number] } : {}),
      ...(data.camera_up ? { camera_up: [...data.camera_up] as [number, number, number] } : {}),
      ...(data.camera_zoom !== undefined ? { camera_zoom: data.camera_zoom, camera_projection: 'orthographic' as const } : {
        camera_zoom: undefined,
        camera_projection: 'perspective' as const,
      }),
    }
  }

  const current_camera_pose = (): CameraPose | undefined => normalize_camera_pose({
    position: sceneProps.camera_position,
    target: sceneProps.camera_target,
    up: sceneProps.camera_up ?? [0, 1, 0],
    projection: sceneProps.camera_projection ?? (sceneProps.camera_zoom !== undefined ? 'orthographic' : 'perspective'),
    zoom: sceneProps.camera_zoom,
  })

  const apply_camera_pose = (pose: CameraPose): void => {
    sceneProps = {
      ...sceneProps,
      camera_position: [...pose.position] as [number, number, number],
      camera_target: [...pose.target] as [number, number, number],
      camera_up: [...pose.up] as [number, number, number],
      camera_projection: pose.projection,
      auto_rotate: 0,
      ...(pose.zoom !== undefined ? { camera_zoom: pose.zoom } : { camera_zoom: undefined }),
    }
  }

  const fit_surface = (): void => {
    const canvas = viewerShell?.querySelector('canvas')
    const camera = canvas ? scene_registry.get(canvas)?.camera : undefined
    if (!surfaceResult || !camera || !surfaceActive) return
    const xyz = surfaceResult.xyz, scale = surfaceResult.metadata.bohrToAngstrom
    const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < xyz.length; i++) { const axis = i % 3; low[axis] = Math.min(low[axis], xyz[i] * scale); high[axis] = Math.max(high[axis], xyz[i] * scale) }
    const pose = current_camera_pose() ?? normalize_camera_pose({ position: camera.position.toArray(), up: camera.up.toArray(),
      target: [(low[0] + high[0]) / 2, (low[1] + high[1]) / 2, (low[2] + high[2]) / 2], projection: camera instanceof OrthographicCamera ? 'orthographic' : 'perspective',
      ...(camera instanceof OrthographicCamera ? { zoom: camera.zoom } : {}),
    })
    if (!pose) return
    let radius = .1
    for (let i = 0; i < xyz.length; i += 3) radius = Math.max(radius, Math.hypot(xyz[i] * scale - pose.target[0], xyz[i + 1] * scale - pose.target[1], xyz[i + 2] * scale - pose.target[2]))
    radius *= 1.12
    if (camera instanceof PerspectiveCamera) {
      const halfAngle = Math.atan(Math.tan(camera.fov * Math.PI / 360) * Math.min(1, camera.aspect))
      const distance = radius / Math.sin(halfAngle), old = Math.hypot(...pose.position.map((v, i) => v - pose.target[i]))
      apply_camera_pose({ ...pose, position: pose.position.map((v, i) => pose.target[i] + (v - pose.target[i]) * distance / old) as [number, number, number] })
    } else if (camera instanceof OrthographicCamera) {
      apply_camera_pose({ ...pose, zoom: Math.min(camera.right - camera.left, camera.top - camera.bottom) / (2 * radius) })
    }
    surfaceFitPending = false
  }

  const step_rotate = (direction: CameraDirection): void => {
    const pose = current_camera_pose()
    const step = normalize_camera_step(rotationStep, 'rotation')
    if (pose && step !== undefined) {
      rotationStep = step
      apply_camera_pose(rotate_camera(pose, direction, step))
    }
  }

  const step_pan = (horizontal: number, vertical: number): void => {
    const pose = current_camera_pose()
    const step = normalize_camera_step(panStep, 'pan')
    if (pose && step !== undefined) {
      panStep = step
      apply_camera_pose(pan_camera(pose, horizontal * step, vertical * step))
    }
  }

  const step_zoom = (direction: 'in' | 'out'): void => {
    const pose = current_camera_pose()
    const step = normalize_camera_step(zoomStep, 'zoom')
    if (pose && step !== undefined) {
      zoomStep = step
      apply_camera_pose(zoom_camera(pose, step, direction))
    }
  }

  const set_show_gizmo = (value: boolean): void => {
    showGizmo = value
    sceneProps = { ...sceneProps, show_gizmo: value }
  }

  const apply_inspector_scene_props = (next: Record<string, unknown>): void => {
    const { background_color, background_opacity, ...scene } = next
    sceneProps = scene as typeof sceneProps
    if (typeof scene.show_gizmo === 'boolean') showGizmo = scene.show_gizmo
    if (typeof background_color === 'string') backgroundColor = background_color
    if (typeof background_opacity === 'number' && Number.isFinite(background_opacity)) {
      backgroundOpacity = Math.max(0, Math.min(1, background_opacity))
    }
  }

  const set_inspector_unit_cell = (value: boolean): void => {
    showUnitCell = value
    latticeProps = {
      ...latticeProps,
      cell_edge_opacity: value ? 1 : 0,
      show_cell_vectors: value,
    }
  }

  const open_panel = (panel: 'layers' | 'slice' | 'logs'): void => {
    const next = panel === 'layers' ? !layerOpen
      : panel === 'slice' ? !sliceOpen
        : !logOpen
    layerOpen = panel === 'layers' && next
    sliceOpen = panel === 'slice' && next
    logOpen = panel === 'logs' && next
  }

  const set_range = (axis: number, bound: number, value: number): void => {
    const current = isosurfaceSettings.display_range ?? [[0, 1], [0, 1], [0, 1]]
    const next = current.map((range) => [...range]) as [[number, number], [number, number], [number, number]]
    const clamped = clamp_periodic_bound(value)
    if (clamped === undefined) return
    const [lower, upper] = next[axis]
    next[axis][bound] = bound === 0 ? Math.min(clamped, upper) : Math.max(clamped, lower)
    isosurfaceSettings = { ...isosurfaceSettings, display_range: next }
  }

  $effect(() => {
    measuredSites
    structure
    displayedStructure
    close_bond_context_menu()
  })

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

  onMount(load_manifest)

  onMount(() => {
    if (window.innerWidth < 1000) inspectorOpen = false
    if (window.innerWidth < 760) orbitalPanelOpen = false
    const narrowViewport = window.matchMedia('(max-width: 800px)')
    const collapse_sidebars = (event: MediaQueryListEvent): void => {
      if (event.matches) { inspectorOpen = false; orbitalPanelOpen = false }
    }
    narrowViewport.addEventListener('change', collapse_sidebars)
    const close_on_outside_pointer = (event: PointerEvent): void => {
      if (!bondContextMenu || !bondContextMenuElement) return
      if (event.target instanceof Node && bondContextMenuElement.contains(event.target)) return
      close_bond_context_menu()
    }
    const close_on_escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && bondContextMenu) close_bond_context_menu()
    }
    document.addEventListener('pointerdown', close_on_outside_pointer, true)
    window.addEventListener('keydown', close_on_escape)
    window.addEventListener('resize', close_bond_context_menu)
    window.addEventListener('blur', close_bond_context_menu)
    return () => {
      stop_spectrum_job()
      narrowViewport.removeEventListener('change', collapse_sidebars)
      document.removeEventListener('pointerdown', close_on_outside_pointer, true)
      window.removeEventListener('keydown', close_on_escape)
      window.removeEventListener('resize', close_bond_context_menu)
      window.removeEventListener('blur', close_bond_context_menu)
    }
  })
</script>

<main class="workbench" class:has-periodic={Boolean(manifest.periodic?.enabled) && activeResult === 'scene'}>
  <header class="toolbar">
    <div class="brand">
      <strong>Multiwfn</strong>
      <span>Workbench</span>
    </div>
    <label class="result-picker">
      <span>Result</span>
      <select aria-label="Active result" value={activeResult} disabled={savingResult} onchange={(event) => show_result(event.currentTarget.value)}>
        <option value="scene" disabled={!scene_available}>3D scene</option>
        {#each plots as plot (plot.id)}<option value={plot.id}>{plot_title(plot.artifact)}</option>{/each}
      </select>
    </label>
    <button type="button" title="Open numeric curves or a saved plot document" onclick={() => plotInput?.click()} disabled={importingPlot || savingResult}>
      <Icon icon="Directory" width="16" height="16" /><span>Open plot</span>
    </button>
    <input class="hidden-file-input" bind:this={plotInput} type="file" accept=".txt,.dat,.csv,.json" multiple onchange={open_plot_files} />
    {#if activeResult === 'scene'}
    <WorkbenchMenu name="view" label="View" bind:active={openMenu}>
    <div class="menu-heading">Camera</div>
    <div class="camera-tools" aria-label="Fixed-step camera controls">
      <label title="Rotation step in degrees">
        <span>Step (deg)</span>
        <input aria-label="Rotation step" type="number" min="0.1" max="180" step="0.1" bind:value={rotationStep} />
      </label>
      <div class="axis-step" aria-label="Rotate camera to move visible structure">
        <button class="icon-button" type="button" title="Rotate up" aria-label="Rotate up" onclick={() => step_rotate('up')} disabled={!current_camera_pose()}><Icon icon="ArrowUp" width="15" height="15" /></button>
        <button class="icon-button" type="button" title="Rotate down" aria-label="Rotate down" onclick={() => step_rotate('down')} disabled={!current_camera_pose()}><Icon icon="ArrowDown" width="15" height="15" /></button>
        <button class="icon-button" type="button" title="Rotate left" aria-label="Rotate left" onclick={() => step_rotate('left')} disabled={!current_camera_pose()}><Icon icon="ArrowLeft" width="15" height="15" /></button>
        <button class="icon-button" type="button" title="Rotate right" aria-label="Rotate right" onclick={() => step_rotate('right')} disabled={!current_camera_pose()}><Icon icon="ArrowRight" width="15" height="15" /></button>
        <button class="icon-button" type="button" title="Roll clockwise" aria-label="Roll clockwise" onclick={() => step_rotate('clockwise')} disabled={!current_camera_pose()}><Icon icon="Redo" width="15" height="15" /></button>
        <button class="icon-button" type="button" title="Roll counterclockwise" aria-label="Roll counterclockwise" onclick={() => step_rotate('counterclockwise')} disabled={!current_camera_pose()}><Icon icon="Undo" width="15" height="15" /></button>
      </div>
      <label title="Camera-relative pan step in world units">
        <span>Move</span>
        <input aria-label="Pan step" type="number" min="0.001" max="100" step="0.01" bind:value={panStep} />
      </label>
      <div class="pan-step" aria-label="Pan camera">
        <button type="button" title="Pan left" aria-label="Pan left" onclick={() => step_pan(-1, 0)} disabled={!current_camera_pose()}><Icon icon="ArrowLeft" width="15" height="15" /></button>
        <button type="button" title="Pan up" aria-label="Pan up" onclick={() => step_pan(0, 1)} disabled={!current_camera_pose()}><Icon icon="ArrowUp" width="15" height="15" /></button>
        <button type="button" title="Pan down" aria-label="Pan down" onclick={() => step_pan(0, -1)} disabled={!current_camera_pose()}><Icon icon="ArrowDown" width="15" height="15" /></button>
        <button type="button" title="Pan right" aria-label="Pan right" onclick={() => step_pan(1, 0)} disabled={!current_camera_pose()}><Icon icon="ArrowRight" width="15" height="15" /></button>
      </div>
      <label title="Reciprocal zoom step in percent">
        <span>Zoom (%)</span>
        <input aria-label="Zoom step" type="number" min="0.1" max="500" step="0.1" bind:value={zoomStep} />
      </label>
      <button class="icon-button" type="button" title="Zoom out" aria-label="Zoom out" onclick={() => step_zoom('out')} disabled={!current_camera_pose()}><Icon icon="ZoomOut" width="16" height="16" /></button>
      <button class="icon-button" type="button" title="Zoom in" aria-label="Zoom in" onclick={() => step_zoom('in')} disabled={!current_camera_pose()}><Icon icon="ZoomIn" width="16" height="16" /></button>
    </div>
    <label><input type="checkbox" bind:checked={inspectorOpen} onchange={() => { surfacePanelOpen = false; topologyPanelOpen = false }} /><span>Inspector</span></label>
    {#if orbital_selection_available()}<label><input type="checkbox" bind:checked={orbitalPanelOpen} /><span>Orbitals</span></label>{/if}
    <label><input type="checkbox" checked={showGizmo !== false} onchange={(event) => set_show_gizmo(event.currentTarget.checked)} /><span>Axes</span></label>
    <button type="button" onclick={() => { openMenu = undefined; open_panel('layers') }}>Volume layers ({volumeEntries.length})</button>
    <button type="button" onclick={() => { openMenu = undefined; open_panel('slice') }} disabled={!volumetricData?.length}>2D Slice</button>
    {#if topologyResult}<button type="button" onclick={() => { openMenu = undefined; surfaceActive = false; surfacePanelOpen = false; topologyPanelOpen = true; topologyActive = !topologyActive }} aria-pressed={topologyActive}>Topology view</button>{/if}
    </WorkbenchMenu>
    <WorkbenchMenu name="tools" label="Tools" bind:active={openMenu}>
    <div class="menu-heading">Spectra</div>
    <button type="button" onclick={() => spectrumInput?.click()} disabled={importingSpectrum}>Import spectrum outputs...</button>
    {#each SPECTRUM_KINDS as kind}
      <AnalysisAction reason={spectrum_reason(kind)} busy={importingSpectrum} onclick={() => open_spectrum(kind)}>{SPECTRUM_NAMES[kind]}</AnalysisAction>
    {/each}
    <div class="menu-heading">Quantitative molecular surface</div>
    <AnalysisAction reason={surfaceResult ? '' : 'Run main function 12, then choose post-processing option 0 to view its results'} busy={false} onclick={open_surface_results}>Quantitative surface results...</AnalysisAction>
    <div class="menu-heading">Topology analysis (AIM)</div>
    <AnalysisAction reason={topologyReason} busy={loading} onclick={() => { openMenu = undefined; surfacePanelOpen = false; topologyPanelOpen = true; inspectorOpen = false; orbitalPanelOpen = false }}>AIM critical points and paths...</AnalysisAction>
    <div class="menu-heading">Electrostatic potential</div>
    <label>
      <span>Density iso</span>
      <input type="number" min="0.000001" max="0.1" step="0.0001" bind:value={espIsovalue} />
    </label>
    <AnalysisAction
      onclick={() => { openMenu = undefined; void request_esp() }}
      busy={loading}
      reason={manifest.espAnalysis?.available === true ? '' : manifest.espAnalysis?.reason || 'No ESP calculation is available in this session'}
    >ESP surface</AnalysisAction>
    {#if esp_pair()}
      <button type="button" onclick={() => espLegendOpen = !espLegendOpen} aria-expanded={espLegendOpen}>ESP legend</button>
      <button type="button" onclick={calculate_esp_extrema} disabled={espExtremaLoading}>Approx. ESP extrema</button>
    {/if}
    <div class="menu-heading">Bond-order analysis</div>
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
      <button type="button" onclick={() => save_result('png')} disabled={savingResult || (!active_plot && !scene_available)}><Icon icon="Download" width="16" height="16" />PNG image</button>
      {#if active_plot}
        <button type="button" onclick={() => save_result('pdf')} disabled={savingResult}>PDF figure</button>
        <button type="button" onclick={() => save_result('svg')} disabled={savingResult}>SVG figure</button>
        <button type="button" onclick={() => save_result('csv')} disabled={savingResult}>CSV numeric data</button>
        <button type="button" onclick={() => save_result('json')} disabled={savingResult}>Plot document (.json)</button>
      {:else}
        <button type="button" onclick={() => { export_state(); openMenu = undefined }} disabled={!scene_available}>Save display settings</button>
        <button type="button" onclick={() => { stateInput?.click(); openMenu = undefined }} disabled={!scene_available || loading}>Restore display settings...</button>
      {/if}
    </WorkbenchMenu>
    <input class="hidden-file-input" bind:this={stateInput} type="file" accept="application/json,.json" onchange={import_state_file} />
    {#if active_plot && !active_plot.native}
      <button class="icon-button" type="button" title="Close current plot" aria-label="Close current plot" onclick={close_plot} disabled={savingResult}><Icon icon="Cross" width="16" height="16" /></button>
    {/if}
    <button class="icon-button" type="button" title="Operation log" aria-label="Operation log" onclick={() => open_panel('logs')} aria-expanded={logOpen}><Icon icon="Info" width="16" height="16" /></button>
    <button class="return" type="button" title="Return to the Multiwfn calculation menu" onclick={return_to_multiwfn} disabled={returnPending || savingResult}>Return</button>
  </header>

  {#if manifest.periodic?.enabled && activeResult === 'scene'}
    <section class="periodic-bar" aria-label="Periodic surface range">
      <strong>Surface range</strong>
      {#each ['a', 'b', 'c'] as axis, axis_idx}
        <label>
          <span>{axis}</span>
          <input
            type="number"
            step="0.05"
            value={isosurfaceSettings.display_range?.[axis_idx]?.[0] ?? 0}
            oninput={(event) => set_range(axis_idx, 0, Number(event.currentTarget.value))}
          />
          <span>to</span>
          <input
            type="number"
            step="0.05"
            value={isosurfaceSettings.display_range?.[axis_idx]?.[1] ?? 1}
            oninput={(event) => set_range(axis_idx, 1, Number(event.currentTarget.value))}
          />
        </label>
      {/each}
      <label>
        <span>Atoms</span>
        <input class="supercell" bind:value={supercellScaling} aria-label="Atom supercell" />
      </label>
      <label>
        <input type="checkbox" bind:checked={showImageAtoms} />
        <span>Boundary atoms</span>
      </label>
      <label>
        <input
          type="checkbox"
          bind:checked={showUnitCell}
          onchange={() => latticeProps = {
            ...latticeProps,
            cell_edge_opacity: showUnitCell ? 1 : 0,
            show_cell_vectors: showUnitCell,
          }}
        />
        <span>Cell frame</span>
      </label>
    </section>
  {/if}

  <div class="result-stage" bind:this={resultStage}>
  <input class="hidden-file-input" bind:this={spectrumInput} type="file" accept=".out,.log,.txt,.output" multiple onchange={import_spectrum_files} />
  <section class="workspace" class:has-topology={topologyPanelOpen || surfacePanelOpen} class:inactive={activeResult !== 'scene'} inert={activeResult !== 'scene'} aria-hidden={activeResult !== 'scene'} class:inspector-closed={!inspectorOpen && !topologyPanelOpen && !surfacePanelOpen} class:has-orbitals={orbital_selection_available() && orbitalPanelOpen}>
    <nav class="tool-rail" aria-label="Inspector tools">
      <button type="button" class:active={inspectorOpen && inspectorSection === 'structure'} aria-label="Open structure inspector" aria-expanded={inspectorOpen} onclick={() => { inspectorSection = 'structure'; inspectorOpen = true; topologyPanelOpen = false; surfacePanelOpen = false }}>
        <span aria-hidden="true">S</span><small>Structure</small>
      </button>
      <button type="button" class:active={inspectorOpen && inspectorSection === 'surfaces'} aria-label="Open surfaces inspector" aria-expanded={inspectorOpen} onclick={() => { inspectorSection = 'surfaces'; inspectorOpen = true; topologyPanelOpen = false; surfacePanelOpen = false }}>
        <span aria-hidden="true">V</span><small>Surfaces</small>
      </button>
      {#if manifest.periodic?.enabled}
        <button type="button" class:active={inspectorOpen && inspectorSection === 'cell'} aria-label="Open cell inspector" aria-expanded={inspectorOpen} onclick={() => { inspectorSection = 'cell'; inspectorOpen = true; topologyPanelOpen = false; surfacePanelOpen = false }}>
          <span aria-hidden="true">C</span><small>Cell</small>
        </button>
      {/if}
      <button type="button" class:active={layerOpen} aria-label={`Open volume layers (${volumeEntries.length})`} aria-expanded={layerOpen} onclick={() => open_panel('layers')}>
        <span aria-hidden="true">L</span><small>Layers</small>
      </button>
      {#if orbital_selection_available()}
      <button type="button" class:active={orbitalPanelOpen} aria-label="Toggle orbitals" aria-expanded={orbitalPanelOpen} onclick={() => orbitalPanelOpen = !orbitalPanelOpen}>
        <span aria-hidden="true">O</span><small>Orbitals</small>
      </button>
      {/if}
      <button type="button" class="rail-close" aria-label="Close inspector" aria-expanded={inspectorOpen || surfacePanelOpen || topologyPanelOpen} onclick={() => { inspectorOpen = false; surfacePanelOpen = false; topologyPanelOpen = false }}>
        <span aria-hidden="true">&lt;</span><small>Hide</small>
      </button>
    </nav>

    {#if inspectorOpen && !topologyPanelOpen && !surfacePanelOpen}
      <ViewerInspector
        bind:section={inspectorSection}
        scene_props={{ ...sceneProps, background_color: backgroundColor, background_opacity: backgroundOpacity }}
        isosurface_settings={isosurfaceSettings}
        periodic={Boolean(manifest.periodic?.enabled)}
        supercell_scaling={supercellScaling}
        show_image_atoms={showImageAtoms}
        show_unit_cell={showUnitCell}
        volume_count={volumeEntries.length}
        on_scene_props_change={apply_inspector_scene_props}
        on_isosurface_settings_change={(next) => isosurfaceSettings = {
          ...next,
          geometry_memory_budget_bytes: isosurfaceSettings.geometry_memory_budget_bytes,
        }}
        on_supercell_change={(value) => supercellScaling = value}
        on_boundary_atoms_change={(value) => showImageAtoms = value}
        on_unit_cell_change={set_inspector_unit_cell}
        on_range_change={set_range}
        on_layers={() => { open_panel('layers'); inspectorOpen = false }}
        on_close={() => inspectorOpen = false}
      />
    {/if}

    {#if surfacePanelOpen && surfaceResult}
      <SurfaceAnalysisPanel result={surfaceResult} bind:display={surfaceDisplay} bind:active={surfaceActive} bind:selection={surfaceSelection} onclose={() => surfacePanelOpen = false} onexport={export_surface} onfit={fit_surface} />
    {:else if topologyPanelOpen}
      <TopologyPanel bind:options={topologyOptions} bind:display={topologyDisplay} bind:active={topologyActive} bind:selection={topologySelection} result={topologyResult} busy={loading} reason={topologyReason} cell={topologyCell} onrun={() => void request_topology()} onclose={() => topologyPanelOpen = false} onexport={export_topology} />
    {/if}
    <section class="viewer-shell">
    <div class="scene-viewport" bind:this={viewerShell}>
      {#if structure}
        <Structure
          bind:structure
          bind:displayed_structure={displayedStructure}
          bind:volumetric_data={volumetricData}
          bind:isosurface_settings={isosurfaceSettings}
          bind:active_volume_idx={activeVolumeIdx}
          bind:measured_sites={measuredSites}
          bind:measure_mode={measureMode}
          bind:supercell_scaling={supercellScaling}
          bind:show_image_atoms={showImageAtoms}
          bind:lattice_props={latticeProps}
          bind:scene_props={sceneProps}
          bind:background_color={backgroundColor}
          bind:background_opacity={backgroundOpacity}
          bind:loading={structureLoading}
          bind:error_msg={viewerError}
          on_camera_move={track_camera}
          on_camera_reset={track_camera}
          on_geometry_error={(message) => report_error(new Error(message))}
          on_selected_bond_context={open_bond_context_menu}
          show_atom_tooltip={false}
          measure_selection_policy={{
            distance: { max_sites: 2, overflow: 'restart' },
            angle: { max_sites: 4, overflow: 'reject' },
          }}
          measure_geometry="ordered"
          show_controls="always"
          allow_file_drop={false}
          topology_view={topologyActive && Boolean(topologyResult)}
          surface_view={surfaceActive && Boolean(surfaceResult)}
          scene_children={topologyScene}
        />
      {:else if !loading}
        <div class="empty">No structure is available in this session.</div>
      {/if}
      {#if bondContextMenu && manifest.bondAnalysis?.methods}
        <div
          class="bond-analysis-menu"
          role="menu"
          tabindex="-1"
          aria-label={`Calculate bond order for atoms ${bondContextMenu.source_site_indices[0] + 1} and ${bondContextMenu.source_site_indices[1] + 1}`}
          bind:this={bondContextMenuElement}
          style={`left: ${bondContextMenu.left}px; top: ${bondContextMenu.top}px; max-width: ${bondContextMenu.max_width}px; max-height: ${bondContextMenu.max_height}px;`}
        >
          <header role="presentation">
            <strong>Bond order</strong>
            <span>Atoms {bondContextMenu.source_site_indices[0] + 1}–{bondContextMenu.source_site_indices[1] + 1}</span>
            {#if bondContextMenu.bond_order !== undefined}
              <small>Displayed bond: {typeof bondContextMenu.bond_order === 'number' ? bondContextMenu.bond_order.toPrecision(4) : bondContextMenu.bond_order}</small>
            {/if}
          </header>
          <div class="bond-analysis-methods" role="presentation">
            {#each Object.entries(manifest.bondAnalysis.methods) as [method, capability]}
              {@const unavailableReason = unavailable_bond_method_reason(method)}
              <button
                type="button"
                role="menuitem"
                aria-disabled={Boolean(unavailableReason)}
                disabled={Boolean(unavailableReason)}
                title={unavailableReason || `Calculate ${bond_method_label(method)} bond order`}
                onclick={() => request_context_bond(method)}
              >
                <span>{bond_method_label(method)}</span>
                {#if unavailableReason}<small>{capability.reason || unavailableReason}</small>{/if}
              </button>
            {/each}
          </div>
        </div>
      {/if}
      {#if sliceOpen}
        <SlicePanel
          volumes={volumetricData ?? []}
          bind:active_volume_idx={activeVolumeIdx}
          bind:open={sliceOpen}
          bind:axis={slicePlane}
          bind:miller_h={sliceMillerH}
          bind:miller_k={sliceMillerK}
          bind:miller_l={sliceMillerL}
          bind:position={slicePosition}
          bind:resolution={sliceResolution}
          bind:colormap={sliceColormap}
          bind:range_mode={sliceRangeMode}
          bind:manual_min={sliceManualMin}
          bind:manual_max={sliceManualMax}
        />
      {/if}
      {#if !topologyActive && !surfaceActive && espLegendOpen && esp_pair()}
        {@const legendRange = current_esp_range()}
        <EspLegend min={legendRange[0]} max={legendRange[1]} bind:visible={espLegendOpen} bind:position={espLegendPosition} />
      {/if}
    </div>
    {#if loading || measuredSites.length || bondResults.length}
      <div class="scene-readouts" aria-label="Calculation and measurement results">
        {#if loading}
          <div class="calculation-status" role="status"><progress aria-label={workingMessage}></progress><span>{workingMessage}</span></div>
        {/if}
        <MeasurementReadout structure={displayedStructure ?? structure} sites={measuredSites} mode={measureMode} bonds={bondResults}
          on_clear_selection={() => measuredSites = []}
          on_remove_bond={(key) => bondResults = bondResults.filter((result) => result.key !== key)} />
      </div>
    {/if}
    </section>

    {#if orbital_selection_available() && orbitalPanelOpen}
      <aside class="orbital-panel" aria-label="Orbital controls">
        <header>
          <div><strong>Orbitals</strong><small>{orbital_count()}</small></div>
          <span class:offline={!orbitalBackendAvailable}>{orbitalBackendAvailable ? 'Connected' : 'Cached only'}</span>
        </header>
        <div class="orbital-frontiers" aria-label="Frontier orbitals">
          {#each [Number(homoIndex), Number(homoIndex) + 1] as index}
            {@const label = orbital_frontier_label(index, homoIndex, manifest.bondAnalysis?.openShell)}
            {#if label && index <= orbital_count()}
              <button type="button" class:active={orbitalIndex === index} onclick={() => activate_orbital(index)}
                disabled={loading || (!orbitalBackendAvailable && loaded_orbital_volume_index(volumeEntries, index) === undefined)}>{label} <strong>{index}</strong></button>
            {/if}
          {/each}
        </div>
        {#if manifest.orbitals?.items?.length}
          <div class="orbital-list" bind:this={orbitalListElement} role="listbox" aria-label="Orbital list">
            <button type="button" class:active={orbitalIndex === 0} role="option" aria-selected={orbitalIndex === 0} onclick={() => activate_orbital(0)} disabled={loading}>None</button>
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
            <button type="button" title="Previous orbital" aria-label="Previous orbital" onclick={() => step_orbital(-1)} disabled={loading || orbitalIndex <= 1}>&lt;</button>
            <input aria-label="Orbital index" type="number" min="0" max={orbital_count() || undefined} bind:value={orbitalIndex} disabled={loading} />
            <button type="button" title="Next orbital" aria-label="Next orbital" onclick={() => step_orbital(1)} disabled={loading || orbitalIndex >= orbital_count()}>&gt;</button>
          </div>
          <button type="button" onclick={() => request_orbital()} disabled={loading || !orbital_selection_valid() || (!orbitalBackendAvailable && loaded_orbital_volume_index(volumeEntries, orbitalIndex) === undefined)}>{orbitalIndex === 0 ? 'Hide orbitals' : 'Show orbital'}</button>
          <label>
            <span>Orbital isovalue</span>
            <input type="number" min="0.000001" max="0.3" step="0.001" value={orbitalIsovalue} onchange={(event) => change_orbital_isovalue(event.currentTarget.valueAsNumber)} />
          </label>
          <label>
            <span>Grid precision</span>
            <select value={quality} onchange={change_orbital_quality} disabled={loading || !orbitalBackendAvailable}>
              {#each manifest.espAnalysis?.qualityLevels ?? ORBITAL_GRID_QUALITY_LEVELS as level}
                <option value={level}>{Math.round(level / 1000)}k points</option>
              {/each}
            </select>
          </label>
          {#if !orbitalBackendAvailable}<p>Reopen Multiwfn menu 0 to calculate uncached orbitals.</p>{/if}
        </div>
      </aside>
    {/if}

  </section>
  {#each plots as plot (plot.id)}
    <section class="result-document" class:inactive={activeResult !== plot.id} inert={activeResult !== plot.id} aria-hidden={activeResult !== plot.id} aria-label={plot.artifact.title}>
      {#if activeResult === plot.id && activeSpectrum}
        <SpectrumControls data={activeSpectrum} datasets={spectrumData} bind:options={spectrumSettings[activeSpectrum.id]} busy={spectrumBusy} onpick={select_spectrum} onupdate={update_spectrum} onremove={remove_spectrum} />
      {/if}
      {#key plot.artifact}
      <div class="result-plot">
      <MultiwfnPlotView artifact={plot.artifact} resolver={plot.resolver}
        showStickLabels={plot.id.startsWith('spectrum:') ? spectrumSettings[plot.id.slice('spectrum:'.length)]?.labels === true : true}
        exportConfig={plot.native ? plot_export(manifest) : undefined}
        onExported={return_to_multiwfn} onExportError={report_error} />
      </div>
      {/key}
    </section>
  {/each}
  </div>

  <footer class="statusbar" class:error={Boolean(errorMessage)}>
    <span role="status">{savingResult ? 'Exporting...' : importingSpectrum ? 'Reading spectrum outputs...' : spectrumBusy ? 'Updating spectrum...' : importingPlot ? 'Opening plot...' : errorMessage || status}</span>
    <span>{active_plot ? '2D plot' : `${volumetricData?.length || 0} volume(s)`}</span>
  </footer>

  {#if layerOpen}
    <aside class="layer-panel" aria-label="Volume layers">
      <header>
        <strong>Volume layers</strong>
        <button type="button" onclick={() => layerOpen = false}>Close</button>
      </header>
      <div class="layer-list">
        {#each volumeEntries as entry, volumeIdx}
          {@const layer = (isosurfaceSettings.layers ?? []).find((item) => item.volume_idx === volumeIdx)}
          <section class:active={activeVolumeIdx === volumeIdx}>
            <div class="layer-heading">
              <label>
                <input
                  type="checkbox"
                  checked={layer?.visible !== false}
                  onchange={(event) => update_layer(volumeIdx, { visible: event.currentTarget.checked })}
                />
                <button class="layer-name" type="button" onclick={() => activeVolumeIdx = volumeIdx}>
                  {entry.name || entry.role || `Volume ${volumeIdx + 1}`}
                </button>
              </label>
              <button type="button" title="Remove layer" aria-label="Remove layer" onclick={() => remove_volume(volumeIdx)}>×</button>
            </div>
            <div class="layer-controls">
              <label>
                <span>Iso</span>
                <input
                  type="number"
                  min="0.000001"
                  step="0.001"
                  value={layer?.isovalue ?? 0.001}
                  onchange={(event) => update_layer(volumeIdx, { isovalue: Number(event.currentTarget.value) })}
                />
              </label>
              <label>
                <span>Opacity</span>
                <input
                  type="range"
                  min="0.05"
                  max="1"
                  step="0.05"
                  value={layer?.opacity ?? 0.82}
                  oninput={(event) => update_layer(volumeIdx, { opacity: Number(event.currentTarget.value) })}
                />
              </label>
              <label class="color-source">
                <span>Color by</span>
                <select
                  value={layer?.color_volume_idx ?? -1}
                  onchange={(event) => set_color_volume(volumeIdx, Number(event.currentTarget.value))}
                >
                  <option value={-1}>Solid</option>
                  {#each volumeEntries as colorEntry, colorIdx}
                    {#if colorIdx !== volumeIdx}
                      <option
                        value={colorIdx}
                        disabled={!grids_compatible(volumeIdx, colorIdx)}
                      >{colorEntry.name || colorEntry.role || `Volume ${colorIdx + 1}`}</option>
                    {/if}
                  {/each}
                </select>
              </label>
              <label>
                <span>Positive color</span>
                <input
                  type="color"
                  value={layer?.color || '#2563eb'}
                  oninput={(event) => update_layer(volumeIdx, { color: event.currentTarget.value })}
                />
              </label>
              <label class="check-control">
                <input
                  type="checkbox"
                  checked={layer?.show_negative === true}
                  onchange={(event) => update_layer(volumeIdx, { show_negative: event.currentTarget.checked })}
                />
                <span>Negative phase</span>
              </label>
              {#if layer?.show_negative}
                <label>
                  <span>Negative color</span>
                  <input
                    type="color"
                    value={layer.negative_color || '#dc2626'}
                    oninput={(event) => update_layer(volumeIdx, { negative_color: event.currentTarget.value })}
                  />
                </label>
              {/if}
              {#if layer?.color_volume_idx !== undefined}
                <label>
                  <span>Colormap</span>
                  <select
                    value={layer.colormap || 'interpolateRdBu'}
                    onchange={(event) => update_layer(volumeIdx, { colormap: event.currentTarget.value as IsosurfaceLayer['colormap'] })}
                  >
                    <option value="interpolateTransFlag">Trans flag (pink / white / blue)</option>
                    <option value="interpolateRdBu">Red / blue</option>
                    <option value="interpolateViridis">Viridis</option>
                    <option value="interpolateTurbo">Turbo</option>
                    <option value="interpolateCool">Cool</option>
                    <option value="interpolateWarm">Warm</option>
                    <option value="interpolateRdYlGn">Red / yellow / green</option>
                    <option value="interpolateGreys">Greys</option>
                  </select>
                </label>
                <label>
                  <span>Range min</span>
                  <input
                    type="number"
                    step="0.001"
                    value={layer.color_range?.[0] ?? -0.05}
                    onchange={(event) => set_color_range(volumeIdx, 0, event.currentTarget.valueAsNumber)}
                  />
                </label>
                <label>
                  <span>Range max</span>
                  <input
                    type="number"
                    step="0.001"
                    value={layer.color_range?.[1] ?? 0.05}
                    onchange={(event) => set_color_range(volumeIdx, 1, event.currentTarget.valueAsNumber)}
                  />
                </label>
              {/if}
            </div>
          </section>
        {:else}
          <div class="panel-empty">No volume layers.</div>
        {/each}
      </div>
    </aside>
  {/if}

  {#if logOpen}
    <aside class="log-panel" aria-label="Operation log">
      <header>
        <strong>Operation log</strong>
        <div>
          <button type="button" onclick={copy_log} disabled={!logEntries.length}>Copy</button>
          <button type="button" onclick={() => logEntries = []} disabled={!logEntries.length}>Clear</button>
          <button type="button" onclick={() => logOpen = false}>Close</button>
        </div>
      </header>
      <div class="log-list">
        {#each logEntries as entry}
          <div class:error={entry.level === 'error'}>
            <time>{entry.timestamp}</time>
            <span>{entry.message}</span>
          </div>
        {:else}
          <div class="log-empty">No operations recorded.</div>
        {/each}
      </div>
    </aside>
  {/if}

  {#if activeResult === 'scene' && !topologyActive && !surfaceActive && espExtremaOpen && esp_pair()}
    <aside class="esp-extrema-panel" aria-label="Approximate ESP surface extrema">
      <header>
        <strong>Approximate ESP extrema</strong>
        <button type="button" onclick={() => espExtremaOpen = false}>Close</button>
      </header>
      {#if espExtremaLoading}
        <div class="panel-empty">Calculating bounded visual estimates...</div>
      {:else if espExtrema}
        <div class="esp-extrema-list">
          {#each [...espExtrema.minima, ...espExtrema.maxima] as point}
            <div class:minimum={point.type === 'minimum'}>
              <strong>{point.type === 'minimum' ? 'Min' : 'Max'} {point.rank}</strong>
              <span>{point.kcalMolPerElectron.toFixed(2)} kcal/mol/e</span>
              <small>{point.x.toFixed(3)}, {point.y.toFixed(3)}, {point.z.toFixed(3)}</small>
            </div>
          {:else}
            <div class="panel-empty">No finite interior extrema found.</div>
          {/each}
        </div>
      {/if}
    </aside>
  {/if}
</main>

{#snippet topologyScene()}
  {#if surfaceActive && surfaceResult}
    <SurfaceAnalysisOverlay result={surfaceResult} display={surfaceDisplay} selection={surfaceSelection} onready={() => { if (surfaceFitPending) fit_surface() }} onselect={(selection) => { surfaceSelection = selection; surfacePanelOpen = true; topologyPanelOpen = false }} />
  {:else if topologyActive && topologyResult}
    <TopologyOverlay result={topologyResult} display={topologyDisplay} selection={topologySelection} cell={topologyCell} onselect={(selection) => { topologySelection = selection; topologyPanelOpen = true }} />
  {/if}
{/snippet}

<style>
  .bond-analysis-menu {
    position: fixed;
    z-index: 70;
    width: min(260px, calc(100vw - 16px));
    overflow: auto;
    color: #18202a;
    background: #fff;
    border: 1px solid #aeb8c5;
    border-radius: 7px;
    box-shadow: 0 12px 32px rgb(23 32 42 / 24%);
  }

  .bond-analysis-menu:focus {
    outline: 2px solid #1976b8;
    outline-offset: 1px;
  }

  .bond-analysis-menu > header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 2px 10px;
    padding: 9px 10px 8px;
    background: #f5f7f9;
    border-bottom: 1px solid #d6dce4;
  }

  .bond-analysis-menu > header strong {
    font-size: 12px;
  }

  .bond-analysis-menu > header span,
  .bond-analysis-menu > header small {
    color: #667085;
    font-size: 10px;
  }

  .bond-analysis-menu > header small {
    grid-column: 1 / -1;
  }

  .bond-analysis-methods {
    display: grid;
    gap: 2px;
    padding: 5px;
  }

  .bond-analysis-methods button {
    display: grid;
    justify-items: start;
    width: 100%;
    min-height: 32px;
    height: auto;
    padding: 6px 8px;
    text-align: left;
    border-color: transparent;
    background: transparent;
  }

  .bond-analysis-methods button span {
    font-weight: 600;
  }

  .bond-analysis-methods button small {
    margin-top: 2px;
    color: #667085;
    font-size: 10px;
    line-height: 1.25;
    white-space: normal;
  }
</style>
