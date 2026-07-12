<script lang="ts">
  import {
    DEFAULT_ISOSURFACE_SETTINGS,
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
  import {
    cube_entries,
    display_range,
    manifest_url,
    resolve_entry_url,
    type ManifestEntry,
    type MultiwfnManifest,
  } from './manifest'

  let manifest = $state<MultiwfnManifest>({})
  let manifestBase = $state(new URL('/session/', window.location.href))
  let structure = $state<AnyStructure | undefined>()
  let volumetricData = $state<VolumetricData[] | undefined>()
  let volumeEntries = $state<ManifestEntry[]>([])
  let isosurfaceSettings = $state<IsosurfaceSettings>({ ...DEFAULT_ISOSURFACE_SETTINGS })
  let activeVolumeIdx = $state(0)
  let measuredSites = $state<number[]>([])
  let supercellScaling = $state('1x1x1')
  let loading = $state(true)
  let errorMessage = $state<string | undefined>()
  let status = $state('Loading Multiwfn session...')
  let orbitalIndex = $state(0)
  let quality = $state(120000)
  let espIsovalue = $state(0.001)
  let bondMethod = $state('mayer')
  let logOpen = $state(false)
  let layerOpen = $state(false)
  let logEntries = $state<Array<{ timestamp: string; level: 'info' | 'error'; message: string }>>([])

  type ApiPayload = {
    ok?: boolean
    message?: string
    layer?: ManifestEntry
    densityLayer?: ManifestEntry
    espLayer?: ManifestEntry
    method?: string
    value?: number
    components?: Record<string, number>
  }

  const add_log = (message: string, level: 'info' | 'error' = 'info'): void => {
    logEntries = [...logEntries, { timestamp: new Date().toLocaleTimeString(), level, message }]
  }

  const set_status = (message: string): void => {
    status = message
    add_log(message)
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
    if (!structure) structure = parsed.find((item) => item.structure)?.structure
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
      return [{ ...layer, volume_idx: nextVolumeIdx, color_volume_idx: nextColorIdx }]
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

  const update_layer = (volumeIdx: number, patch: Partial<IsosurfaceLayer>): void => {
    const layers = isosurfaceSettings.layers ?? []
    isosurfaceSettings = {
      ...isosurfaceSettings,
      layers: layers.map((layer) => layer.volume_idx === volumeIdx ? { ...layer, ...patch } : layer),
    }
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

  const load_structure = async (): Promise<void> => {
    const entry = manifest.structure
    if (!entry?.path) return
    const text = await fetch_text(resolve_entry_url(entry, manifestBase))
    structure = parse_any_structure(text, entry.path)
  }

  const load_manifest = async (): Promise<void> => {
    loading = true
    errorMessage = undefined
    try {
      const url = manifest_url()
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) throw new Error(`Manifest request returned HTTP ${response.status}`)
      manifest = (await response.json()) as MultiwfnManifest
      manifestBase = new URL('.', url)
      quality = Number(manifest.espAnalysis?.defaultQuality ?? 120000)
      espIsovalue = Number(manifest.espAnalysis?.defaultIsovalue ?? 0.001)
      orbitalIndex = Number(manifest.orbitals?.homoIndex ?? manifest.multiwfnGui?.state?.homoIndex ?? 0)
      const availableBondMethod = Object.entries(manifest.bondAnalysis?.methods ?? {})
        .find(([, capability]) => capability.available !== false)?.[0]
      if (availableBondMethod) bondMethod = availableBondMethod
      const entries = cube_entries(manifest)
      if (manifest.structure?.path) await load_structure()
      if (entries.length) await apply_entries(entries, manifestBase)
      set_status(entries.length ? `${entries.length} volume layer(s) loaded` : 'Structure loaded')
    } catch (error) {
      report_error(error)
      status = 'Session loading failed'
    } finally {
      loading = false
    }
  }

  const request_orbital = async (): Promise<void> => {
    if (orbitalIndex <= 0) return
    loading = true
    errorMessage = undefined
    add_log(`Requesting orbital ${orbitalIndex} at grid quality ${quality}`)
    try {
      const params = new URLSearchParams({
        index: String(orbitalIndex),
        quality: String(quality),
        isovalue: '0.02',
      })
      const response = await fetch(api_url('/api/orbital', params), { cache: 'no-store' })
      const payload = await read_api_payload(response)
      if (!response.ok || !payload.ok || !payload.layer) {
        throw new Error(payload.message || 'Orbital calculation failed')
      }
      remove_volumes((entry) => entry.role === 'orbital' && entry.orbitalIndex === orbitalIndex)
      await apply_entries([payload.layer], new URL('/session/', window.location.href), 'append')
      set_status(`Orbital ${orbitalIndex} loaded`)
    } catch (error) {
      report_error(error)
    } finally {
      loading = false
    }
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
      const firstVolumeIdx = await apply_entries(entries, new URL('/session/', window.location.href), 'append')
      const volumes = volumetricData ?? []
      if (volumes.length >= firstVolumeIdx + 2) {
        const color = auto_color_config(volumes[firstVolumeIdx + 1].data_range)
        isosurfaceSettings = {
          ...isosurfaceSettings,
          layers: (isosurfaceSettings.layers ?? []).map((layer) => layer.volume_idx === firstVolumeIdx
            ? {
                ...layer,
                color_volume_idx: firstVolumeIdx + 1,
                colormap: color.colormap,
                color_range: color.color_range,
              }
            : layer.volume_idx === firstVolumeIdx + 1 ? { ...layer, visible: false } : layer),
        }
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
    try {
      const response = await fetch(api_url('/api/return'), { cache: 'no-store' })
      const payload = await read_api_payload(response)
      if (!response.ok || !payload.ok) throw new Error(payload.message || 'Return request failed')
      set_status('Returning to Multiwfn...')
    } catch (error) {
      report_error(error)
    }
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

  const set_range = (axis: number, bound: number, value: number): void => {
    const current = isosurfaceSettings.display_range ?? [[0, 1], [0, 1], [0, 1]]
    const next = current.map((range) => [...range]) as [[number, number], [number, number], [number, number]]
    next[axis][bound] = value
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
    <label>
      <span>Orbital</span>
      <input type="number" min="1" max={manifest.orbitals?.count || undefined} bind:value={orbitalIndex} />
    </label>
    <button type="button" onclick={request_orbital} disabled={loading || orbitalIndex <= 0}>Show orbital</button>
    <label>
      <span>Grid</span>
      <select bind:value={quality}>
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
    <button type="button" onclick={() => layerOpen = !layerOpen} aria-expanded={layerOpen}>Layers ({volumeEntries.length})</button>
    <button type="button" onclick={() => logOpen = !logOpen} aria-expanded={logOpen}>Logs ({logEntries.length})</button>
    <button class="return" type="button" onclick={return_to_multiwfn}>Return</button>
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
    </section>
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
        bind:loading
        bind:error_msg={errorMessage}
        show_controls="always"
        allow_file_drop={true}
      />
    {:else if !loading}
      <div class="empty">No structure is available in this session.</div>
    {/if}
    {#if loading}<div class="loading">Working...</div>{/if}
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
</main>
