<script lang="ts">
  import { t } from './i18n'
  import * as Select from '$lib/components/ui/select'
  let { value, options, label, placeholder = 'Choose…', disabled = false, translateOptions = true, onchange }: {
    value: string; options: readonly { value: string; label: string; disabled?: boolean }[];
    label: string; placeholder?: string; disabled?: boolean; translateOptions?: boolean; onchange: (value: string) => void
  } = $props()
  const selected = $derived(options.find((option) => option.value === value))
</script>
<Select.Root type="single" {value} {disabled} onValueChange={(next) => { if (next !== value) onchange(next) }}>
  <Select.Trigger aria-label={$t(label)} size="sm" class="w-full bg-background text-xs">
    <span class="truncate">{selected ? (translateOptions ? $t(selected.label) : selected.label) : $t(placeholder)}</span>
  </Select.Trigger>
  <Select.Content class="z-[220] max-w-[calc(100vw-16px)]" align="start" collisionPadding={8}>
    {#each options as option (option.value)}
      <Select.Item value={option.value} label={translateOptions ? $t(option.label) : option.label} disabled={option.disabled} class="text-xs">{translateOptions ? $t(option.label) : option.label}</Select.Item>
    {/each}
  </Select.Content>
</Select.Root>
