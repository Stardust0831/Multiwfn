import { parse_spectrum_output, spectrum_plot, type SpectrumData, type SpectrumSettings } from './spectra'

self.onmessage = (event: MessageEvent<{ action: 'parse'; text: string; name: string } | { action: 'plot'; data: SpectrumData; options: SpectrumSettings }>): void => {
  try {
    const message = event.data
    const result = message.action === 'parse' ? parse_spectrum_output(message.text, message.name) : spectrum_plot(message.data, message.options)
    self.postMessage({ ok: true, result })
  } catch (error) { self.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) }) }
}
