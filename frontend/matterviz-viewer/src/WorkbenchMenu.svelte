<script lang="ts">
  import { t } from './i18n'
  import { ChevronDown, Eye, Wrench, Download } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import * as Popover from '$lib/components/ui/popover'
  import type { Snippet } from 'svelte'
  let { name, label, active = $bindable(), children }: {
    name: string; label: string; active?: string; children: Snippet
  } = $props()
  let panel = $state<HTMLDivElement | null>(null)
</script>

<Popover.Root open={active === name} onOpenChange={(open) => active = open ? name : active === name ? undefined : active}>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button {...props} variant="ghost" size="sm" class="gap-1.5 text-xs">
        {#if name === 'view'}<Eye size={15} />{:else if name === 'tools'}<Wrench size={15} />{:else}<Download size={15} />{/if}
        {$t(label)}<ChevronDown size={13} />
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content bind:ref={panel} onOpenAutoFocus={(event) => { event.preventDefault(); panel?.focus() }} role="dialog" id={`workbench-menu-${name}`} aria-label={$t(`${label} controls`)} align="start" sideOffset={8} collisionPadding={8}
    class="workbench-menu z-[200] w-[320px] max-w-[calc(100vw-16px)] max-h-[var(--bits-popover-content-available-height)] overflow-y-auto p-2.5 gap-1">
    {@render children()}
  </Popover.Content>
</Popover.Root>
