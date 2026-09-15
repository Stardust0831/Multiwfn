<script lang="ts">
  import { t } from './i18n'
  import { Info } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import * as Tooltip from '$lib/components/ui/tooltip'
  import type { Snippet } from 'svelte'
  let { reason = '', busy = false, onclick, children }: { reason?: string; busy?: boolean; onclick: () => void; children: Snippet } = $props()
</script>
<div class="analysis-action flex min-w-0 items-center gap-1">
  <Button variant="outline" size="sm" class="h-auto min-h-8 flex-1 justify-start whitespace-normal text-left text-xs" {onclick} disabled={busy || Boolean(reason)} title={$t(reason)}>{@render children()}</Button>
  {#if reason}
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="ghost" size="icon-sm" aria-label={$t(reason)}><Info size={15} /></Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="bottom" sideOffset={7} class="z-[240] max-w-[280px] leading-relaxed">{$t(reason)}</Tooltip.Content>
      </Tooltip.Root>
    </Tooltip.Provider>
  {/if}
</div>
