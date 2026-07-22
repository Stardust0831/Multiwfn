<script lang="ts">
  import { Icon } from 'matterviz'
  import { onDestroy } from 'svelte'
  import {
    create_update_client,
    is_update_active,
    poll_update_status,
    type UpdateState,
    type UpdateStatus,
  } from './update'

  export let open = false
  export let page: URL = new URL(window.location.href)
  export let initial_status: UpdateStatus | undefined
  export let onclose: (() => void) | undefined = undefined
  export let onstatus: ((status: UpdateStatus) => void) | undefined = undefined

  const client = create_update_client(page)
  let status: UpdateStatus = initial_status ?? { visible: false, state: 'idle', conflicts: [] }
  let busy = false
  let last_action: 'check' | 'stage' | 'install' = 'check'
  let stop_poll: (() => void) | undefined

  $: if (initial_status) status = initial_status

  const close = (): void => {
    stop_poll?.()
    stop_poll = undefined
    onclose?.()
  }

  const start_poll = (next: UpdateStatus): void => {
    stop_poll?.()
    stop_poll = poll_update_status({
      client,
      initial: next,
      onStatus: (value) => { status = value; onstatus?.(value) },
      onError: (error) => {
        status = { ...status, state: 'error', message: error instanceof Error ? error.message : 'Update status could not be read' }
        onstatus?.(status)
      },
    })
  }

  const run_action = async (action: 'check' | 'stage' | 'install'): Promise<void> => {
    if (busy) return
    busy = true
    last_action = action
    stop_poll?.()
    stop_poll = undefined
    try {
      const next = await client[action]()
      status = next
      onstatus?.(next)
      if (is_update_active(next.state)) start_poll(next)
    } catch (error) {
      status = { ...status, state: 'error', message: error instanceof Error ? error.message : 'Update request failed' }
      onstatus?.(status)
    } finally {
      busy = false
    }
  }

  const retry = (): void => { void run_action(last_action === 'install' ? 'check' : last_action) }

  const progress_label = (state: UpdateState): string => {
    if (state === 'checking') return 'Checking for a signed update...'
    if (state === 'staging') return 'Downloading and verifying the update...'
    if (state === 'installing') return 'Installing the verified update...'
    if (state === 'recovery') return 'The updater is in recovery mode.'
    return 'Working...'
  }

  onDestroy(() => stop_poll?.())
</script>

{#if open}
  <div class="update-backdrop" role="presentation">
    <dialog class="update-modal" open aria-labelledby="update-heading">
      <header class="update-modal-header">
        <div>
          <span class="update-kicker">MatterViz updater</span>
          <h2 id="update-heading">Update Multiwfn</h2>
        </div>
        <button class="icon-button" type="button" title="Dismiss updater" aria-label="Dismiss updater" onclick={close} disabled={busy}>
          <Icon icon="Cross" width="16" height="16" />
        </button>
      </header>

      <div class="update-modal-body">
        <div class="update-tags" aria-label="Update versions">
          <div><span>Current</span><strong>{status.currentTag ?? 'Unknown'}</strong></div>
          <div><span>Target</span><strong>{status.targetTag ?? 'Not selected'}</strong></div>
        </div>

        {#if status.state === 'idle'}
          <p>Check for a signed Multiwfn update.</p>
          <button class="update-primary" type="button" onclick={() => run_action('check')} disabled={busy}>
            <Icon icon="Version" width="15" height="15" /> Check for updates
          </button>
        {:else if status.state === 'available'}
          <p>A verified update is available.</p>
          <button class="update-primary" type="button" onclick={() => run_action('stage')} disabled={busy}>
            <Icon icon="Download" width="15" height="15" /> Download and verify
          </button>
        {:else if status.state === 'ready'}
          <p class="update-warning">The update is ready. Installing closes this WebView. Type <code>q</code> in Multiwfn after it closes, then restart Multiwfn manually.</p>
          <button class="update-primary" type="button" onclick={() => run_action('install')} disabled={busy}>
            <Icon icon="Download" width="15" height="15" /> Install update
          </button>
        {:else if status.state === 'conflict'}
          <p class="update-warning">No files were changed. Resolve the listed conflicts, then retry.</p>
          {#if status.conflicts.length}
            <ul class="update-conflicts">
              {#each status.conflicts as conflict}<li>{conflict}</li>{/each}
            </ul>
          {/if}
          <div class="update-actions"><button type="button" onclick={retry} disabled={busy}>Retry</button><button type="button" onclick={close}>Dismiss</button></div>
        {:else if status.state === 'recovery'}
          <p>{status.message ?? 'The updater needs recovery before another attempt.'}</p>
          <p class="update-recovery">Close this window, keep the Multiwfn installation unchanged, and restart Multiwfn to retry recovery.</p>
          <div class="update-actions"><button type="button" onclick={retry} disabled={busy}>Retry</button><button type="button" onclick={close}>Dismiss</button></div>
        {:else if status.state === 'error'}
          <p class="update-error">{status.message ?? 'The update request failed.'}</p>
          <div class="update-actions"><button type="button" onclick={retry} disabled={busy}><Icon icon="Version" width="14" height="14" /> Retry</button><button type="button" onclick={close}>Dismiss</button></div>
        {:else}
          <p>{progress_label(status.state)}</p>
          <div class="update-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(status.progress ?? 0)}>
            <span style={`width: ${status.progress ?? 0}%`}></span>
          </div>
          <small>{status.progress === undefined ? 'Please keep this window open.' : `${Math.round(status.progress)}%`}</small>
        {/if}
      </div>
    </dialog>
  </div>
{/if}
