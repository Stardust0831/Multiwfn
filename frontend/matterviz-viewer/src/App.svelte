<script lang="ts">
  import {
    DEFAULT_ISOSURFACE_SETTINGS,
    Structure,
    auto_color_config,
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
  let isosurfaceSettings = $state<IsosurfaceSettings>({ ...DEFAULT_ISOSURFACE_SETTINGS })
  let activeVolumeIdx = $state(0)
  let supercellScaling = $state('1x1x1')
  let loading = $state(true)
  let errorMessage = $state<string | undefined>()
  let status = $state('Loading Multiwfn session...')
  let orbitalIndex = $state(0)
  let quality = $state(120000)
  let espIsovalue = $state(0.001)

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

  const apply_entries = async (entries: ManifestEntry[], base: URL): Promise<void> => {
    const parsed = await Promise.all(entries.map((entry) => parse_cube_entry(entry, base)))
    const volumes = parsed.flatMap((item) => item.volumes)
    if (!structure) structure = parsed.find((item) => item.structure)?.structure
    volumetricData = volumes
    isosurfaceSettings = {
      ...DEFAULT_ISOSURFACE_SETTINGS,
      display_range: display_range(manifest),
      layers: entries.flatMap((entry, idx) =>
        parsed[idx].volumes.map((_, local_idx) =>
          layer_for_entry(entry, parsed.slice(0, idx).reduce((sum, item) => sum + item.volumes.length, 0) + local_idx),
        ),
      ),
    }
    activeVolumeIdx = 0
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
      const entries = cube_entries(manifest)
      if (manifest.structure?.path) await load_structure()
      if (entries.length) await apply_entries(entries, manifestBase)
      status = entries.length ? `${entries.length} volume layer(s) loaded` : 'Structure loaded'
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error)
      status = 'Session loading failed'
    } finally {
      loading = false
    }
  }

  const request_orbital = async (): Promise<void> => {
    if (orbitalIndex <= 0) return
    loading = true
    try {
      const params = new URLSearchParams({
        index: String(orbitalIndex),
        quality: String(quality),
        isovalue: '0.02',
      })
      const response = await fetch(`/api/orbital?${params}`, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok || !payload.ok) throw new Error(payload.message || 'Orbital calculation failed')
      await apply_entries([payload.layer], new URL('/session/', window.location.href))
      status = `Orbital ${orbitalIndex} loaded`
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error)
    } finally {
      loading = false
    }
  }

  const request_esp = async (): Promise<void> => {
    loading = true
    try {
      const params = new URLSearchParams({
        quality: String(quality),
        isovalue: String(espIsovalue),
      })
      const response = await fetch(`/api/esp?${params}`, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok || !payload.ok) throw new Error(payload.message || 'ESP calculation failed')
      const entries: ManifestEntry[] = [payload.densityLayer, payload.espLayer]
      await apply_entries(entries, new URL('/session/', window.location.href))
      const volumes = volumetricData ?? []
      if (volumes.length >= 2) {
        const color = auto_color_config(volumes[1].data_range)
        isosurfaceSettings = {
          ...isosurfaceSettings,
          layers: [{
            ...layer_for_entry(payload.densityLayer, 0),
            color_volume_idx: 1,
            colormap: color.colormap,
            color_range: color.color_range,
          }],
        }
      }
      status = 'ESP mapped onto the electron-density surface'
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error)
    } finally {
      loading = false
    }
  }

  const return_to_multiwfn = async (): Promise<void> => {
    await fetch('/api/return', { cache: 'no-store' })
    status = 'Returning to Multiwfn...'
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
</main>
