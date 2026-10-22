<script lang="ts">
  import { t, locale } from './i18n'
  import { documentation_text, type ConfDocumentation } from './workflow-builder'
  export let documentation: ConfDocumentation = {}
  const fields = ['summary', 'inputs', 'outputs', 'notes'] as const
  const headings = { summary: 'Purpose', inputs: 'Input requirements', outputs: 'Outputs and units', notes: 'Usage notes' }
  $: title = documentation_text(documentation.title, $locale)
  $: entries = fields.map(key => ({ key, ...documentation_text(documentation[key], $locale) })).filter(entry => entry.text)
  $: languages = new Set([...(title.text ? [title.language] : []), ...entries.map(entry => entry.language)])
</script>

<article>
  {#if title.text}<h3 lang={title.language === 'und' ? undefined : title.language}>{title.text}</h3>{/if}
  {#if languages.has($locale === 'en' ? 'zh' : 'en')}<p class="fallback">{$t($locale === 'en' ? 'English unavailable for some text; showing Chinese.' : 'Chinese unavailable for some text; showing English.')}</p>{/if}
  {#if languages.has('und')}<p class="fallback">{$t('Original conf comments (language unspecified).')}</p>{/if}
  {#each entries as entry}
    <section><h4>{$t(headings[entry.key])}</h4><p lang={entry.language === 'und' ? undefined : entry.language}>{entry.text}</p></section>
  {/each}
  {#if !entries.length}<p class="empty">{$t('No documentation has been provided for this item.')}</p>{/if}
</article>

<style>
  article { padding:18px; color:#344b61; font-size:13px; line-height:1.8; overflow-wrap:anywhere; }
  h3 { margin:0 0 16px; font-size:16px; color:#235b81; font-weight:650; }
  section + section { margin-top:20px; } h4 { margin:0 0 5px; font-size:12px; color:#64788b; font-weight:650; }
  p { margin:0; white-space:pre-line; } .fallback { margin-bottom:14px; padding:7px 10px; background:#fff6df; border-radius:5px; color:#84642b; font-size:12px; } .empty { color:#77899a; }
</style>
