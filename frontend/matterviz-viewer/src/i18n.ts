import { derived, writable } from 'svelte/store'
import { zh } from './messages.ts'

export type Locale = 'zh' | 'en'
export const LOCALE_STORAGE_KEY = 'multiwfn-ui-language'
type Parameters = Record<string, string | number>

export const resolve_locale = (saved: unknown, browserLanguage = 'en'): Locale =>
  saved === 'zh' || saved === 'en' ? saved : /^zh(?:-|$)/i.test(browserLanguage) ? 'zh' : 'en'

const initial_locale = (): Locale => {
  if (typeof window === 'undefined') return 'en'
  let saved: string | null = null
  try { saved = window.localStorage.getItem(LOCALE_STORAGE_KEY) } catch { /* Storage can be unavailable in a WebView. */ }
  return resolve_locale(saved, window.navigator.language)
}

export const locale = writable<Locale>(initial_locale())

/** Translate explicit UI messages only. Unknown backend messages retain their original text. */
export const translate = (language: Locale, message: string, parameters: Parameters = {}): string => {
  const template = language === 'zh' && Object.hasOwn(zh, message) ? zh[message as keyof typeof zh] : message
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) =>
    Object.hasOwn(parameters, name) ? String(parameters[name]) : match)
}

export const t = derived(locale, (language) =>
  (message: string, parameters?: Parameters): string => translate(language, message, parameters))

export const set_locale = (language: Locale): void => {
  locale.set(language)
  if (typeof window === 'undefined') return
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
  try { window.localStorage.setItem(LOCALE_STORAGE_KEY, language) } catch { /* Keep the in-memory switch usable. */ }
}

/** Install once at the application boundary; language changes never remount the viewer. */
export const sync_document_locale = (): (() => void) => locale.subscribe((language) => {
  if (typeof document !== 'undefined') document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
})

/** Store UI templates until rendering, so existing status messages switch language too.
 * Raw strings are data (for example plot titles and backend logs) and remain intact. */
export type UiMessage = string | { key: string; parameters: Parameters }
export const ui_message = (key: string, parameters: Parameters = {}): UiMessage => ({ key, parameters })
export const format_message = (language: Locale, message: UiMessage): string =>
  typeof message === 'string' ? message : translate(language, message.key, message.parameters)
