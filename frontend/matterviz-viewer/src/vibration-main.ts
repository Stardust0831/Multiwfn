import 'matterviz/app.css'
import './styles.css'
import { mount } from 'svelte'
import VibrationApp from './VibrationApp.svelte'
import { save_file_via_dialog } from './vibration.ts'

// The vendored matterviz download() helper (dist/io/fetch.js) defers to a
// globalThis.download override when one is installed. WKWebView in the desktop
// shell silently swallows anchor downloads, so route every export payload from
// this page (WebM video, PNG stills, SVG) through the local service: it shows
// a native save dialog and writes the file where the user chooses.
const show_save_toast = (message: string, copy_text?: string): void => {
  const toast = document.createElement('div')
  toast.className = 'save-toast'
  toast.style.bottom = `${16 + document.querySelectorAll('.save-toast').length * 48}px`
  toast.textContent = message
  if (copy_text) {
    toast.title = 'Click to copy the path'
    toast.addEventListener('click', () => {
      void navigator.clipboard?.writeText(copy_text)
      toast.textContent = `Copied: ${copy_text}`
    })
  }
  document.body.append(toast)
  setTimeout(() => toast.remove(), 12_000)
}

const install_download_override = (): void => {
  ;(globalThis as { download?: unknown }).download = (data: unknown, filename?: string) => {
    void (async () => {
      try {
        const result = await save_file_via_dialog(data as Blob, filename ?? 'export')
        if (result.ok && result.path) show_save_toast(`Saved: ${result.path}`, result.path)
        else if (result.cancelled) show_save_toast('Save cancelled')
        else show_save_toast(`Save failed: ${result.message ?? 'unknown error'}`)
      } catch (error) {
        show_save_toast(`Save failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    })()
  }
}

install_download_override()
mount(VibrationApp, { target: document.getElementById('app')! })
