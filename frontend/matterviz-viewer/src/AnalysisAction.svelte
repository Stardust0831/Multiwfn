<script lang="ts">
  import { Icon } from 'matterviz'
  import type { Snippet } from 'svelte'
  let { reason = '', busy = false, onclick, children }: { reason?: string; busy?: boolean; onclick: () => void; children: Snippet } = $props()
</script>
<div class="analysis-action">
  <button type="button" {onclick} disabled={busy || Boolean(reason)} aria-disabled={busy || Boolean(reason)} title={reason}>{@render children()}</button>
  {#if reason}
    <button class="reason-button" type="button" aria-label={reason} title={reason}><Icon icon="Info" width="14" /></button>
    <span role="tooltip">{reason}</span>
  {/if}
</div>
<style>
  .analysis-action{display:flex;gap:5px;position:relative;min-width:0;align-items:center}.analysis-action>button:first-child{flex:1;min-width:0;text-align:left;white-space:normal}.reason-button{flex:0 0 26px;display:grid;place-items:center;padding:3px}button{font:inherit;color:inherit;border:1px solid #d4dce1;border-radius:4px;background:#f6f8f9;min-height:28px;padding:5px 8px;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}[role=tooltip]{display:none;position:absolute;z-index:10;top:100%;left:0;right:0;background:#fff;border:1px solid #ccd5db;padding:8px;box-shadow:0 2px 6px #0002;font-size:11px;overflow-wrap:anywhere}.reason-button:is(:focus,:hover)+[role=tooltip]{display:block}
</style>
