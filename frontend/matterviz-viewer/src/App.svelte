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
  } from 'matterviz'
  import { parse_any_structure } from 'matterviz/structure/parse'
  import { onMount } from 'svelte'
  import { normalize_camera_pose, normalize_camera_step, pan_camera, rotate_camera, zoom_camera, type CameraAxis, type CameraPose } from './camera'
  import EspLegend from './EspLegend.svelte'
  import SlicePanel from './SlicePanel.svelte'
  import ViewerInspector from './ViewerInspector.svelte'
  import {
    estimate_esp_range,
    extract_esp_extrema_async,
    type EspExtremaResult,
    type LegendPosition,
  } from './esp'
  import {
    cube_entries,
    display_range,
    manifest_url,
    resolve_entry_url,
    type ManifestEntry,
    type MultiwfnManifest,
  } from './manifest'
  import {
    exclusive_volume_visibility,
    initial_orbital_volume_index,
    loaded_orbital_volume_index,
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

  let manifest = $state<MultiwfnManifest>({})
  let manifestBase = $state(new URL('/session/', window.location.href))
  let loadedManifestUrl = $state(manifest_url())
  let structure = $state<AnyStructure | undefined>()
  let volumetricData = $state<VolumetricData[] | undefined>()
  let volumeEntries = $state<ManifestEntry[]>([])
  let isosurfaceSettings = $state<IsosurfaceSettings>({ ...DEFAULT_ISOSURFACE_SETTINGS })
  let activeVolumeIdx = $state(0)
  let measuredSites = $state<number[]>([])
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
  let returnPending = $state(false)
  let errorMessage = $state<string | undefined>()
  let status = $state('Loading Multiwfn session...')
  let orbitalIndex = $state(0)
  let quality = $state(120000)
  let espIsovalue = $state(0.001)
  let bondMethod = $state('mayer')
  let logOpen = $state(false)
  let layerOpen = $state(false)
  let sliceOpen = $state(false)
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
  }>({ auto_rotate: 0 })
  let logEntries = $state<Array<{ timestamp: string; level: 'info' | 'error'; message: string }>>([])

  type ApiPayload = {
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

  const add_log = (message: string, level: 'info' | 'error' = 'info'): void => {
    logEntries = [...logEntries, { timestamp: new Date().toLocaleTimeString(), level, message }]
  }

  const set_status = (message: string): void => {
    status = message
    add_log(message)
  }

  const orbital_label = (item: { index: number; energy?: number; occupation?: number }): string => {
    const homo = Number(manifest.orbitals?.homoIndex ?? 0)
    const frontier = manifest.bondAnalysis?.openShell === false
      ? item.index === homo ? 'HOMO' : item.index === homo + 1 ? 'LUMO' : ''
      : ''
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

  const report_error = (error: unknown): void => {
    errorMessage = error instanceof Error ? error.message : String(error)
    add_log(errorMessage, 'error')
  }

  const api_url = (path: string, params?: URLSearchParams): URL => {
    const url = new URL(path, manifestBase)
    if (params) url.search = params.toString()
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
    return {
      isovalue: Math.abs(Number(entry.isovalue ?? (signed ? 0.02 : 0.001))),
      color: signed ? '#2563eb' : '#9ca3af',
      negative_color: '#dc2626',
      opacity: Number(entry.opacity ?? 0.82),
      visible: entry.visible !== false,
      show_negative: signed,
      volume_idx,
    }
  }

  const parse_cube_entry = async (
    entry: ManifestEntry,
    base: URL,
  ): Promise<{ structure?: AnyStructure; volumes: VolumetricData[] }> => {
    const text = await fetch_text(resolve_entry_url(entry, base))
    const parsed = parse_volumetric_file(text, entry.path)
    if (!parsed) throw new Error(`MatterViz could not parse ${entry.path}`)
    const volumes = parsed.volumes.map((volume, idx) => ({
      ...volume,
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
    const parsed = await Promise.all(entries.map((entry) => parse_cube_entry(entry, base)))
    const volumes = parsed.flatMap((item) => item.volumes)
    const expandedEntries = entries.flatMap((entry, idx) => parsed[idx].volumes.map(() => entry))
    if (!structure) {
      const parsedStructure = parsed.find((item) => item.structure)?.structure
      if (parsedStructure) structure = inject_manifest_lattice(parsedStructure, manifest, { override: true })
    }
    const previousVolumes = mode === 'append' ? (volumetricData ?? []) : []
    const previousLayers = mode === 'append' ? (isosurfaceSettings.layers ?? []) : []
    const firstVolumeIdx = previousVolumes.length
    volumetricData = [...previousVolumes, ...volumes]
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

  const remove_volumes = (predicate: (entry: ManifestEntry, index: number) => boolean): void => {
    const volumes = volumetricData ?? []
    const layers = isosurfaceSettings.layers ?? []
    const oldToNew = new Map<number, number>()
    const nextVolumes: VolumetricData[] = []
    const nextEntries: ManifestEntry[] = []
    volumeEntries.forEach((entry, idx) => {
      if (predicate(entry, idx)) return
      oldToNew.set(idx, nextVolumes.length)
      nextVolumes.push(volumes[idx])
      nextEntries.push(entry)
    })
    const nextLayers = layers.flatMap((layer) => {
      const volumeIdx = layer.volume_idx ?? 0
      const nextVolumeIdx = oldToNew.get(volumeIdx)
      if (nextVolumeIdx === undefined) return []
      const nextColorIdx = layer.color_volume_idx === undefined
        ? undefined
        : oldToNew.get(layer.color_volume_idx)
      return [{
        ...layer,
        volume_idx: nextVolumeIdx,
        color_volume_idx: nextColorIdx,
        ...(nextColorIdx === undefined ? { colormap: undefined, color_range: undefined } : {}),
      }]
    })
    volumetricData = nextVolumes
    volumeEntries = nextEntries
    isosurfaceSettings = { ...isosurfaceSettings, layers: nextLayers }
    activeVolumeIdx = oldToNew.get(activeVolumeIdx)
      ?? Math.min(activeVolumeIdx, Math.max(0, nextVolumes.length - 1))
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

  const replace_volume_entry = async (
    volumeIdx: number,
    entry: ManifestEntry,
    base: URL,
  ): Promise<number> => {
    const parsed = await parse_cube_entry(entry, base)
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
      colormap: color.colormap,
      color_range: color.color_range,
    })
  }

  const grids_compatible = (leftIdx: number, rightIdx: number): boolean => {
    const left = volumetricData?.[leftIdx]
    const right = volumetricData?.[rightIdx]
    return Boolean(left && right && compare_volume_grids(left, right).ok)
  }

  const esp_pair = (): { densityIdx: number; potentialIdx: number } | undefined => {
    const layers = isosurfaceSettings.layers ?? []
    const densityIdx = volumeEntries.findIndex((entry) => entry.analysisKind === 'esp-density')
    if (densityIdx >= 0) {
      const linked = layers.find((layer) => layer.volume_idx === densityIdx)?.color_volume_idx
      const potentialIdx = linked ?? volumeEntries.findIndex((entry) => entry.analysisKind === 'esp-potential')
      if (potentialIdx >= 0 && grids_compatible(densityIdx, potentialIdx)) return { densityIdx, potentialIdx }
    }
    const linkedLayer = layers.find((layer) => layer.color_volume_idx !== undefined)
    if (linkedLayer?.volume_idx !== undefined && linkedLayer.color_volume_idx !== undefined
      && grids_compatible(linkedLayer.volume_idx, linkedLayer.color_volume_idx)) {
      return { densityIdx: linkedLayer.volume_idx, potentialIdx: linkedLayer.color_volume_idx }
    }
    return undefined
  }

  const refresh_esp_range = (densityIdx: number, potentialIdx: number): void => {
    const density = volumetricData?.[densityIdx]
    const potential = volumetricData?.[potentialIdx]
    if (!density || !potential) return
    const range = estimate_esp_range(density, potential, espIsovalue, { maxCells: 150000, maxSamples: 50000 })
    espRange = [range.min, range.max]
    update_layer(densityIdx, { color_range: espRange })
  }

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
    set_status('MatterViz workbench state restored')
    add_log('Workbench state restored')
  }

  const load_structure = async (): Promise<void> => {
    const entry = manifest.structure
    if (!entry?.path) return
    const text = await fetch_text(resolve_entry_url(entry, manifestBase))
    structure = inject_manifest_lattice(parse_any_structure(text, entry.path), manifest, { override: true })
  }

  const load_manifest = async (): Promise<void> => {
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
      manifestBase = new URL('.', url)
      quality = Number(manifest.espAnalysis?.defaultQuality ?? 120000)
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
      const initialEsp = esp_pair()
      if (initialEsp) {
        set_color_volume(initialEsp.densityIdx, initialEsp.potentialIdx)
        update_layer(initialEsp.potentialIdx, { visible: false })
        refresh_esp_range(initialEsp.densityIdx, initialEsp.potentialIdx)
        espLegendOpen = true
      }
      set_status(entries.length ? `${entries.length} volume layer(s) loaded` : 'Structure loaded')
      if (startupState) apply_workbench_state(startupState)
    } catch (error) {
      report_error(error)
      status = 'Session loading failed'
    } finally {
      loading = false
    }
  }

  const request_orbital = async (options: { forceRecompute?: boolean } = {}): Promise<void> => {
    if (loading) return
    const requestedIndex = orbitalIndex
    if (requestedIndex === 0) {
      errorMessage = undefined
      activate_only_volume(undefined)
      set_status('No orbital selected')
      return
    }
    if (!Number.isInteger(requestedIndex) || requestedIndex < 1 || requestedIndex > orbital_count()) {
      report_error(new Error(`Orbital index must be an integer from 1 to ${orbital_count()}`))
      return
    }
    errorMessage = undefined
    const cachedVolumeIdx = loaded_orbital_volume_index(volumeEntries, requestedIndex)
    if (cachedVolumeIdx !== undefined && !options.forceRecompute) {
      activate_only_volume(cachedVolumeIdx)
      set_status(`Orbital ${requestedIndex} loaded from session cache`)
      return
    }
    const requestedQuality = quality
    loading = true
    add_log(`Requesting orbital ${requestedIndex} at grid quality ${requestedQuality}`)
    try {
      const params = new URLSearchParams({
        index: String(requestedIndex),
        quality: String(requestedQuality),
        isovalue: '0.02',
      })
      const response = await fetch(api_url('/api/orbital', params), { cache: 'no-store' })
      const payload = await read_api_payload(response)
      if (!response.ok || !payload.ok || !payload.layer) {
        throw new Error(payload.message || 'Orbital calculation failed')
      }
      const layer = {
        ...payload.layer,
        role: 'orbital',
        orbitalIndex: requestedIndex,
        gridQuality: Number(payload.quality ?? requestedQuality),
        isovalue: Number(payload.isovalue ?? payload.layer.isovalue ?? 0.02),
      }
      const activeIdx = cachedVolumeIdx === undefined
        ? await apply_entries([layer], manifestBase, 'append')
        : await replace_volume_entry(cachedVolumeIdx, layer, manifestBase)
      orbitalIndex = requestedIndex
      activate_only_volume(activeIdx)
      set_status(`Orbital ${requestedIndex} loaded`)
    } catch (error) {
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

  const request_esp = async (): Promise<void> => {
    loading = true
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
    } catch (error) {
      report_error(error)
    } finally {
      loading = false
    }
  }

  const request_bond = async (): Promise<void> => {
    const selected = measuredSites.slice(-2)
    if (selected.length !== 2 || selected[0] === selected[1]) {
      report_error(new Error('Select two atoms with the MatterViz measurement tool'))
      return
    }
    loading = true
    errorMessage = undefined
    const atom1 = selected[0] + 1
    const atom2 = selected[1] + 1
    add_log(`Requesting ${bondMethod} bond order for atoms ${atom1} and ${atom2}`)
    try {
      const params = new URLSearchParams({ atom1: String(atom1), atom2: String(atom2), method: bondMethod })
      const response = await fetch(api_url('/api/bond', params), { cache: 'no-store' })
      const payload = await read_api_payload(response)
      if (!response.ok || !payload.ok || !Number.isFinite(Number(payload.value))) {
        throw new Error(payload.message || 'Bond-order calculation failed')
      }
      set_status(`${bondMethod}(${atom1}, ${atom2}) = ${Number(payload.value).toFixed(6)}`)
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

  const step_rotate = (axis: CameraAxis, direction: -1 | 1): void => {
    const pose = current_camera_pose()
    const step = normalize_camera_step(rotationStep, 'rotation')
    if (pose && step !== undefined) {
      rotationStep = step
      apply_camera_pose(rotate_camera(pose, axis, direction * step))
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

  onMount(load_manifest)
</script>

<main class="workbench" class:has-periodic={Boolean(manifest.periodic?.enabled)}>
  <header class="toolbar">
    <div class="brand">
      <strong>Multiwfn</strong>
      <span>MatterViz workbench</span>
    </div>
    <div class="camera-tools" aria-label="Fixed-step camera controls">
      <label title="Rotation step in degrees">
        <span>Step (deg)</span>
        <input aria-label="Rotation step" type="number" min="0.1" max="180" step="0.1" bind:value={rotationStep} />
      </label>
      {#each ['x', 'y', 'z'] as axis}
        <div class="axis-step" aria-label={`Rotate ${axis.toUpperCase()} axis`}>
          <button type="button" title={`Rotate ${axis.toUpperCase()} negative`} aria-label={`Rotate ${axis.toUpperCase()} negative`} onclick={() => step_rotate(axis as CameraAxis, -1)} disabled={!current_camera_pose()}>
            <Icon icon="ArrowLeft" width="15" height="15" /><span>{axis.toUpperCase()}</span>
          </button>
          <button type="button" title={`Rotate ${axis.toUpperCase()} positive`} aria-label={`Rotate ${axis.toUpperCase()} positive`} onclick={() => step_rotate(axis as CameraAxis, 1)} disabled={!current_camera_pose()}>
            <span>{axis.toUpperCase()}</span><Icon icon="ArrowRight" width="15" height="15" />
          </button>
        </div>
      {/each}
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
    <button type="button" title="Previous orbital" aria-label="Previous orbital" onclick={() => move_orbital(-1)} disabled={loading || orbitalIndex <= 1}>&lt;</button>
    <label>
      <span>Orbital</span>
      {#if manifest.orbitals?.items?.length && manifest.orbitals.items.length >= orbital_count()}
        <select bind:value={orbitalIndex} aria-label="Orbital" disabled={loading}>
          <option value={0}>None</option>
          {#each manifest.orbitals.items as item}<option value={item.index}>{orbital_label(item)}</option>{/each}
        </select>
      {:else}
        <input aria-label="Orbital" type="number" min="0" max={orbital_count() || undefined} bind:value={orbitalIndex} disabled={loading} />
      {/if}
    </label>
    <button type="button" title="Next orbital" aria-label="Next orbital" onclick={() => move_orbital(1)} disabled={loading || orbitalIndex >= orbital_count()}>&gt;</button>
    <button type="button" onclick={() => request_orbital()} disabled={loading || !orbital_selection_valid()}>{orbitalIndex === 0 ? 'Hide orbitals' : 'Show orbital'}</button>
    <label>
      <span>Grid</span>
      <select value={quality} onchange={change_orbital_quality} disabled={loading}>
        {#each manifest.espAnalysis?.qualityLevels ?? [25000, 50000, 120000, 300000, 500000] as level}
          <option value={level}>{level.toLocaleString()}</option>
        {/each}
      </select>
    </label>
    <label>
      <span>Density iso</span>
      <input type="number" min="0.000001" max="0.1" step="0.0001" bind:value={espIsovalue} />
    </label>
    <button
      type="button"
      onclick={request_esp}
      disabled={loading || manifest.espAnalysis?.available === false}
      title={manifest.espAnalysis?.reason || ''}
    >ESP surface</button>
    {#if manifest.bondAnalysis?.methods}
      <label>
        <span>Bond</span>
        <select bind:value={bondMethod}>
          {#each Object.entries(manifest.bondAnalysis.methods) as [method, capability]}
            <option value={method} disabled={capability.available === false}>{method}</option>
          {/each}
        </select>
      </label>
      <button
        type="button"
        onclick={request_bond}
        disabled={loading || measuredSites.length < 2 || manifest.bondAnalysis.methods[bondMethod]?.available === false}
        title={manifest.bondAnalysis.methods[bondMethod]?.reason || 'Use the measurement tool to select two atoms'}
      >Calculate</button>
    {/if}
    <button type="button" onclick={() => open_panel('layers')} aria-expanded={layerOpen}>Layers ({volumeEntries.length})</button>
    <button type="button" onclick={() => open_panel('slice')} disabled={!volumetricData?.length} aria-expanded={sliceOpen}>2D Slice</button>
    {#if esp_pair()}
      <button type="button" onclick={() => espLegendOpen = !espLegendOpen} aria-expanded={espLegendOpen}>ESP legend</button>
      <button type="button" onclick={calculate_esp_extrema} disabled={espExtremaLoading}>Approx. ESP extrema</button>
    {/if}
    <label>
      <input
        type="checkbox"
        checked={showGizmo !== false}
        onchange={(event) => set_show_gizmo(event.currentTarget.checked)}
      />
      <span>Axes</span>
    </label>
    <button type="button" onclick={() => stateInput?.click()}>Import</button>
    <button type="button" onclick={export_state}>Export</button>
    <input class="hidden-file-input" bind:this={stateInput} type="file" accept="application/json,.json" onchange={import_state_file} />
    <button type="button" onclick={() => open_panel('logs')} aria-expanded={logOpen}>Logs ({logEntries.length})</button>
    <button class="return" type="button" onclick={return_to_multiwfn} disabled={returnPending}>Return</button>
  </header>

  {#if manifest.periodic?.enabled}
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

  <section class="workspace" class:inspector-closed={!inspectorOpen}>
    <nav class="tool-rail" aria-label="Inspector tools">
      <button type="button" class:active={inspectorOpen && inspectorSection === 'structure'} aria-label="Open structure inspector" aria-expanded={inspectorOpen} onclick={() => { inspectorSection = 'structure'; inspectorOpen = true }}>
        <span aria-hidden="true">S</span><small>Structure</small>
      </button>
      <button type="button" class:active={inspectorOpen && inspectorSection === 'surfaces'} aria-label="Open surfaces inspector" aria-expanded={inspectorOpen} onclick={() => { inspectorSection = 'surfaces'; inspectorOpen = true }}>
        <span aria-hidden="true">V</span><small>Surfaces</small>
      </button>
      {#if manifest.periodic?.enabled}
        <button type="button" class:active={inspectorOpen && inspectorSection === 'cell'} aria-label="Open cell inspector" aria-expanded={inspectorOpen} onclick={() => { inspectorSection = 'cell'; inspectorOpen = true }}>
          <span aria-hidden="true">C</span><small>Cell</small>
        </button>
      {/if}
      <button type="button" class:active={layerOpen} aria-label={`Open volume layers (${volumeEntries.length})`} aria-expanded={layerOpen} onclick={() => open_panel('layers')}>
        <span aria-hidden="true">L</span><small>Layers</small>
      </button>
      <button type="button" class="rail-close" aria-label="Close inspector" aria-expanded={inspectorOpen} onclick={() => inspectorOpen = false}>
        <span aria-hidden="true">&lt;</span><small>Hide</small>
      </button>
    </nav>

    {#if inspectorOpen}
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
        on_isosurface_settings_change={(next) => isosurfaceSettings = next}
        on_supercell_change={(value) => supercellScaling = value}
        on_boundary_atoms_change={(value) => showImageAtoms = value}
        on_unit_cell_change={set_inspector_unit_cell}
        on_range_change={set_range}
        on_layers={() => { open_panel('layers'); inspectorOpen = false }}
        on_close={() => inspectorOpen = false}
      />
    {/if}

    <section class="viewer-shell">
      {#if structure}
        <Structure
          bind:structure
          bind:volumetric_data={volumetricData}
          bind:isosurface_settings={isosurfaceSettings}
          bind:active_volume_idx={activeVolumeIdx}
          bind:measured_sites={measuredSites}
          bind:supercell_scaling={supercellScaling}
          bind:show_image_atoms={showImageAtoms}
          bind:lattice_props={latticeProps}
          bind:scene_props={sceneProps}
          bind:background_color={backgroundColor}
          bind:background_opacity={backgroundOpacity}
          bind:loading
          bind:error_msg={errorMessage}
          on_camera_move={track_camera}
          on_camera_reset={track_camera}
          show_controls="always"
          allow_file_drop={true}
        />
      {:else if !loading}
        <div class="empty">No structure is available in this session.</div>
      {/if}
      {#if loading}<div class="loading">Working...</div>{/if}
      {#if sliceOpen}
        <SlicePanel
          volumes={volumetricData ?? []}
          bind:active_volume_idx={activeVolumeIdx}
          bind:open={sliceOpen}
        />
      {/if}
      {#if espLegendOpen}
        <EspLegend min={espRange[0]} max={espRange[1]} bind:visible={espLegendOpen} bind:position={espLegendPosition} />
      {/if}
    </section>

  </section>

  <footer class="statusbar" class:error={Boolean(errorMessage)}>
    <span>{errorMessage || status}</span>
    <span>{volumetricData?.length || 0} volume(s)</span>
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

  {#if espExtremaOpen}
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
