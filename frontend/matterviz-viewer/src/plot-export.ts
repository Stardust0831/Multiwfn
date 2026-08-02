/** Browser-side export of the scientific plot document.
 *
 * The viewer contains both SVG and HTML layers.  Export builds a standalone
 * SVG from the scientific SVG roots, raster canvas layers, and the small HTML
 * legend/color-bar overlays.  The resulting document is then rendered either
 * by the browser (PNG) or by svg2pdf.js (PDF); no WebView/page screenshot is
 * involved.
 */

export type PlotExportFormat = 'png' | 'pdf'
export type PlotExportRequest = { format: PlotExportFormat; path: string; width?: number; height?: number }
export type PlotExportDimensions = { width: number; height: number }

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const MAX_EXPORT_DIMENSION = 16_384
const MAX_EXPORT_PIXELS = 64_000_000

const finite_dimension = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : fallback

const checked_dimensions = (dimensions: PlotExportDimensions): PlotExportDimensions => {
  if (dimensions.width > MAX_EXPORT_DIMENSION || dimensions.height > MAX_EXPORT_DIMENSION
    || dimensions.width * dimensions.height > MAX_EXPORT_PIXELS) {
    throw new Error(`Plot export dimensions exceed the ${MAX_EXPORT_DIMENSION}px / ${MAX_EXPORT_PIXELS}-pixel limit`)
  }
  return dimensions
}

export const plot_export_dimensions = (
  root: HTMLElement,
  fallback: PlotExportDimensions = { width: 1600, height: 900 },
): PlotExportDimensions => ({
  width: finite_dimension(
    Number(root.dataset.exportWidth),
    finite_dimension(root.scrollWidth || root.clientWidth, fallback.width),
  ),
  height: finite_dimension(
    Number(root.dataset.exportHeight),
    finite_dimension(root.scrollHeight || root.clientHeight, fallback.height),
  ),
})

const escape_xml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')

const escape_text = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')

const number_value = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const style_properties = [
  'color', 'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'stroke-opacity', 'opacity', 'font-family', 'font-size', 'font-style',
  'font-weight', 'letter-spacing', 'text-anchor', 'dominant-baseline',
  'shape-rendering', 'vector-effect', 'transform', 'transform-origin',
  'clip-path', 'mask', 'filter', 'visibility', 'display',
]

const computed_style_text = (element: Element): string => {
  try {
    const get_style = (globalThis as { getComputedStyle?: (element: Element) => CSSStyleDeclaration }).getComputedStyle
    const computed = get_style?.(element)
    if (computed) {
      return style_properties
        .map((property) => `${property}:${computed.getPropertyValue(property)}`)
        .filter((entry) => entry.split(':').slice(1).join(':').trim() !== '')
        .join(';')
    }
  } catch {
    // Detached/partially mocked DOMs may not implement computed styles.
  }
  return element.getAttribute('style') ?? ''
}

const exported_text = (source: Element): SVGTextElement | undefined => {
  if (typeof document === 'undefined') return undefined
  const value = source.textContent?.trim()
  if (!value) return undefined
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
  const x = number_value(source.getAttribute('x'))
  const y = number_value(source.getAttribute('y'))
  const width = number_value(source.getAttribute('width'))
  const height = number_value(source.getAttribute('height'))
  const label = source.querySelector('.static-label, .axis-label, .point-label') ?? source
  text.setAttribute('x', String(x + width / 2))
  text.setAttribute('y', String(y + height * 0.75))
  text.setAttribute('text-anchor', 'middle')
  text.setAttribute('fill', css_value(label, 'color', '#000'))
  text.setAttribute('font-family', css_value(label, 'font-family', 'sans-serif'))
  text.setAttribute('font-size', css_value(label, 'font-size', '12px'))
  const transform = source.getAttribute('transform')
  if (transform) text.setAttribute('transform', transform)
  text.textContent = value
  return text
}

/** Clone an SVG while replacing stylesheet-dependent presentation with values
 * computed by the browser.  This keeps the exported document independent of
 * the viewer's CSS bundle and inherited custom properties. */
const clone_with_inline_styles = (source: SVGElement): SVGElement => {
  const clone = source.cloneNode(true) as SVGElement
  const apply = (original: Element, copy: Element): void => {
    if (original.localName === 'foreignObject') {
      const text = exported_text(original)
      if (text) copy.replaceWith(text)
      else copy.remove()
      return
    }
    const style = computed_style_text(original)
    if (style) copy.setAttribute('style', style)
    const originals = Array.from(original.children)
    const copies = Array.from(copy.children)
    originals.forEach((child, index) => {
      const copy_child = copies[index]
      if (copy_child) apply(child, copy_child)
    })
  }
  apply(source, clone)
  return clone
}

const rect_for = (element: Element, root: HTMLElement): { x: number; y: number; width: number; height: number } => {
  const rect = (element as HTMLElement).getBoundingClientRect?.()
  const root_rect = root.getBoundingClientRect?.()
  const attr_width = number_value(element.getAttribute('width'))
  const attr_height = number_value(element.getAttribute('height'))
  const width = number_value(rect?.width, number_value((element as HTMLElement).clientWidth, attr_width))
  const height = number_value(rect?.height, number_value((element as HTMLElement).clientHeight, attr_height))
  const x = number_value(rect?.left, number_value(element.getAttribute('x')))
    - number_value(root_rect?.left)
  const y = number_value(rect?.top, number_value(element.getAttribute('y')))
    - number_value(root_rect?.top)
  return { x, y, width, height }
}

const transparent_color = (value: string): boolean => {
  const normalized = value.trim().toLowerCase()
  return !normalized || normalized === 'transparent' || normalized === 'none' || /rgba?\([^)]*,\s*0\s*\)$/.test(normalized)
}

const css_value = (element: Element, property: string, fallback: string): string => {
  try {
    const get_style = (globalThis as { getComputedStyle?: (element: Element) => CSSStyleDeclaration }).getComputedStyle
    const value = get_style?.(element)?.getPropertyValue(property)
    if (value?.trim()) return value.trim()
  } catch {
    // Fall through to the attribute/default value.
  }
  return element.getAttribute(property) ?? fallback
}

const css_number = (element: Element, property: string, fallback: number): number => {
  const value = Number.parseFloat(css_value(element, property, String(fallback)))
  return Number.isFinite(value) ? value : fallback
}

const serialize_svg = (element: SVGElement): string => {
  if (typeof XMLSerializer !== 'undefined') return new XMLSerializer().serializeToString(element)
  return element.outerHTML
}

const top_level_scientific_svgs = (root: HTMLElement): SVGElement[] => Array.from(root.querySelectorAll('svg'))
  .filter((svg) => !svg.parentElement?.closest('svg'))
  // Legend swatches are nested HTML decorations and are rebuilt as vectors
  // below.  Including them here would create duplicate nested SVGs.
  .filter((svg) => !svg.matches('.drag-handle'))
  .filter((svg) => !svg.closest('.legend, .color-bar, .colorbar, .header-controls, .plot-controls, .scatter-controls, button, [role="button"]'))

export const canvas_data_url = (canvas: HTMLCanvasElement): string => {
  try {
    return canvas.toDataURL('image/png')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to serialize a scientific Canvas layer: ${reason}`)
  }
}

const marker_svg = (item: Element): Element | null => item.querySelector('.legend-marker svg')

const render_legend = (legend: HTMLElement, root: HTMLElement, scale_x: number, scale_y: number): string => {
  const legend_rect = rect_for(legend, root)
  if (legend_rect.width <= 0 || legend_rect.height <= 0) return ''
  const background = css_value(legend, 'background-color', '#fff')
  const border = css_value(legend, 'border-color', 'none')
  const border_width = css_number(legend, 'border-top-width', 0)
  const chunks: string[] = [
    `<g transform="translate(${legend_rect.x * scale_x} ${legend_rect.y * scale_y}) scale(${scale_x} ${scale_y})">`,
  ]
  if (!transparent_color(background)) {
    chunks.push(`<rect width="${legend_rect.width}" height="${legend_rect.height}" fill="${escape_xml(background)}"/>`)
  }
  if (border_width > 0 && !transparent_color(border)) {
    chunks.push(`<rect x="${border_width / 2}" y="${border_width / 2}" width="${Math.max(0, legend_rect.width - border_width)}" height="${Math.max(0, legend_rect.height - border_width)}" fill="none" stroke="${escape_xml(border)}" stroke-width="${border_width}"/>`)
  }
  for (const item of Array.from(legend.querySelectorAll<HTMLElement>('.legend-item'))) {
    const item_rect = rect_for(item, root)
    const label = item.querySelector<HTMLElement>('.legend-label')
    const label_rect = label ? rect_for(label, root) : item_rect
    const marker = marker_svg(item)
    const marker_rect = item.querySelector<HTMLElement>('.legend-marker')
    const marker_box = marker_rect ? rect_for(marker_rect, root) : item_rect
    const marker_x = marker_box.x - legend_rect.x
    const marker_y = marker_box.y - legend_rect.y + marker_box.height / 2
    const item_opacity = css_number(item, 'opacity', 1)
    const marker_line = marker?.querySelector('line')
    const marker_circle = marker?.querySelector('circle')
    const marker_rect_element = marker?.querySelector('rect')
    if (marker_line) {
      const color = marker_line.getAttribute('stroke') ?? css_value(marker_line, 'stroke', '#000')
      const dash = marker_line.getAttribute('stroke-dasharray')
      chunks.push(`<line x1="${marker_x}" y1="${marker_y}" x2="${marker_x + Math.max(16, marker_box.width - 5)}" y2="${marker_y}" stroke="${escape_xml(color)}" stroke-width="${css_number(marker_line, 'stroke-width', 2)}"${dash ? ` stroke-dasharray="${escape_xml(dash)}"` : ''} opacity="${item_opacity}"/>`)
    } else if (marker_circle) {
      const color = marker_circle.getAttribute('fill') ?? css_value(marker_circle, 'fill', '#000')
      chunks.push(`<circle cx="${marker_x + marker_box.width / 2}" cy="${marker_y}" r="${Math.max(2, Math.min(5, marker_box.height / 2 - 1))}" fill="${escape_xml(color)}" opacity="${item_opacity}"/>`)
    } else if (marker_rect_element) {
      const fill = marker_rect_element.getAttribute('fill') ?? css_value(marker_rect_element, 'fill', '#000')
      const stroke = marker_rect_element.getAttribute('stroke') ?? css_value(marker_rect_element, 'stroke', 'none')
      chunks.push(`<rect x="${marker_x + 2}" y="${marker_y - 5}" width="${Math.max(10, marker_box.width - 8)}" height="10" rx="2" fill="${escape_xml(fill)}"${transparent_color(stroke) ? '' : ` stroke="${escape_xml(stroke)}"`} opacity="${item_opacity}"/>`)
    }
    const text = label?.textContent?.trim() || item.textContent?.trim()
    if (text) {
      const color = css_value(label ?? item, 'color', '#000')
      const font_size = css_number(label ?? item, 'font-size', 12)
      const baseline = label_rect.y - legend_rect.y + Math.max(font_size, label_rect.height * 0.78)
      chunks.push(`<text x="${label_rect.x - legend_rect.x}" y="${baseline}" fill="${escape_xml(color)}" font-size="${font_size}" font-family="sans-serif" opacity="${item_opacity}">${escape_text(text)}</text>`)
    }
  }
  chunks.push('</g>')
  return chunks.join('')
}

const gradient_colors = (value: string): string[] => value
  .match(/(?:rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]{3,8}\b)/gi)
  ?.filter((color) => !/^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,?\s*0?\s*\)$/i.test(color)) ?? []

const render_color_bar = (wrapper: HTMLElement, root: HTMLElement, scale_x: number, scale_y: number, index: number): string => {
  const wrapper_rect = rect_for(wrapper, root)
  if (wrapper_rect.width <= 0 || wrapper_rect.height <= 0) return ''
  const bar = wrapper.querySelector<HTMLElement>('.bar')
  if (!bar) return ''
  const bar_rect = rect_for(bar, root)
  const colors = gradient_colors(css_value(bar, 'background-image', ''))
  const gradient_id = `plot-export-colorbar-${index}`
  const chunks: string[] = [
    `<g transform="translate(${wrapper_rect.x * scale_x} ${wrapper_rect.y * scale_y}) scale(${scale_x} ${scale_y})">`,
    `<defs><linearGradient id="${gradient_id}" x1="0" y1="1" x2="0" y2="0">`,
  ]
  const stops = colors.length >= 2 ? colors : ['#2166ac', '#f7f7f7', '#b2182b']
  stops.forEach((color, stop_index) => chunks.push(`<stop offset="${(stop_index / (stops.length - 1)) * 100}%" stop-color="${escape_xml(color)}"/>`))
  chunks.push(`</linearGradient></defs><rect x="${bar_rect.x - wrapper_rect.x}" y="${bar_rect.y - wrapper_rect.y}" width="${bar_rect.width}" height="${bar_rect.height}" fill="url(#${gradient_id})"/>`)
  const title = wrapper.querySelector<HTMLElement>('.label')
  if (title?.textContent?.trim()) {
    const title_rect = rect_for(title, root)
    chunks.push(`<text x="${title_rect.x - wrapper_rect.x}" y="${title_rect.y - wrapper_rect.y + title_rect.height * 0.8}" fill="${escape_xml(css_value(title, 'color', '#000'))}" font-size="${css_number(title, 'font-size', 11)}" font-family="sans-serif">${escape_text(title.textContent.trim())}</text>`)
  }
  for (const tick of Array.from(wrapper.querySelectorAll<HTMLElement>('.tick-label'))) {
    const tick_rect = rect_for(tick, root)
    if (!tick.textContent?.trim()) continue
    chunks.push(`<text x="${tick_rect.x - wrapper_rect.x}" y="${tick_rect.y - wrapper_rect.y + tick_rect.height * 0.8}" fill="${escape_xml(css_value(tick, 'color', '#000'))}" font-size="${css_number(tick, 'font-size', 10)}" font-family="sans-serif">${escape_text(tick.textContent.trim())}</text>`)
  }
  chunks.push('</g>')
  return chunks.join('')
}

const render_html_frame = (frame: HTMLElement, root: HTMLElement, scale_x: number, scale_y: number): string => {
  const rect = rect_for(frame, root)
  if (rect.width <= 0 || rect.height <= 0) return ''
  const stroke = css_value(frame, 'border-top-color', '#000')
  const stroke_width = Math.max(1, css_number(frame, 'border-top-width', 1))
  return `<rect x="${(rect.x + stroke_width / 2) * scale_x}" y="${(rect.y + stroke_width / 2) * scale_y}" width="${Math.max(0, rect.width - stroke_width) * scale_x}" height="${Math.max(0, rect.height - stroke_width) * scale_y}" fill="none" stroke="${escape_xml(stroke)}" stroke-width="${stroke_width}" shape-rendering="crispEdges"/>`
}

/** Serialize scientific SVGs and non-SVG scientific decorations into one
 * standalone SVG at explicit native page dimensions. */
export const plot_document_svg = (
  root: HTMLElement,
  dimensions = plot_export_dimensions(root),
): string => {
  const root_rect = root.getBoundingClientRect?.()
  const root_width = number_value(root_rect?.width, number_value(root.scrollWidth || root.clientWidth, dimensions.width)) || dimensions.width
  const root_height = number_value(root_rect?.height, number_value(root.scrollHeight || root.clientHeight, dimensions.height)) || dimensions.height
  const scale_x = dimensions.width / root_width
  const scale_y = dimensions.height / root_height
  const chunks: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${dimensions.width}" height="${dimensions.height}" viewBox="0 0 ${dimensions.width} ${dimensions.height}">`,
    `<rect width="${dimensions.width}" height="${dimensions.height}" fill="#fff"/>`,
  ]
  // Density/field canvases are the raster base; axes, labels and curves follow
  // as vectors so they remain selectable and sharp in PDF output.
  for (const canvas of Array.from(root.querySelectorAll<HTMLCanvasElement>('canvas'))) {
    const href = canvas_data_url(canvas)
    const rect = rect_for(canvas, root)
    const width = rect.width || canvas.width
    const height = rect.height || canvas.height
    if (width <= 0 || height <= 0) continue
    chunks.push(`<image x="${rect.x * scale_x}" y="${rect.y * scale_y}" width="${width * scale_x}" height="${height * scale_y}" href="${escape_xml(href)}" xlink:href="${escape_xml(href)}" preserveAspectRatio="none"/>`)
  }
  for (const svg of top_level_scientific_svgs(root)) {
    const rect = rect_for(svg, root)
    if (rect.width <= 0 || rect.height <= 0) continue
    const clone = clone_with_inline_styles(svg)
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
    clone.setAttribute('width', String(rect.width))
    clone.setAttribute('height', String(rect.height))
    clone.removeAttribute('x')
    clone.removeAttribute('y')
    chunks.push(`<g transform="translate(${rect.x * scale_x} ${rect.y * scale_y}) scale(${scale_x} ${scale_y})">${serialize_svg(clone)}</g>`)
  }
  let color_bar_index = 0
  for (const legend of Array.from(root.querySelectorAll<HTMLElement>('.legend'))) {
    if (!legend.closest('svg')) chunks.push(render_legend(legend, root, scale_x, scale_y))
  }
  for (const color_bar of Array.from(root.querySelectorAll<HTMLElement>('.color-bar'))) {
    if (!color_bar.closest('svg')) chunks.push(render_color_bar(color_bar, root, scale_x, scale_y, color_bar_index++))
  }
  for (const frame of Array.from(root.querySelectorAll<HTMLElement>('div.scientific-plot-frame'))) {
    chunks.push(render_html_frame(frame, root, scale_x, scale_y))
  }
  chunks.push('</svg>')
  return chunks.join('')
}

const rasterize_svg = async (svg: string, dimensions: PlotExportDimensions): Promise<Uint8Array> => {
  if (typeof document === 'undefined') throw new Error('PNG export requires a browser document')
  const blob = new Blob([svg], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Unable to rasterize plot SVG'))
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = dimensions.width
    canvas.height = dimensions.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D context is unavailable')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const response = await fetch(canvas.toDataURL('image/png'))
    if (!response.ok) throw new Error('Unable to encode plot PNG')
    return new Uint8Array(await response.arrayBuffer())
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Convert the standalone SVG with maintained SVG/PDF libraries.  Keeping the
 * conversion async allows those browser-only libraries to stay out of the
 * initial viewer chunk. */
export const svg_to_pdf = async (svg: string, dimensions: PlotExportDimensions): Promise<Uint8Array> => {
  if (typeof DOMParser === 'undefined') throw new Error('PDF export requires a browser DOM')
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
  if (!parsed.documentElement || parsed.querySelector('parsererror')) throw new Error('Unable to parse plot SVG for PDF export')
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')])
  // Keep content streams readable for host-side diagnostics and downstream
  // PDF tooling; svg2pdf still emits native path/text operators.
  const pdf = new jsPDF({ unit: 'pt', format: [dimensions.width, dimensions.height], orientation: dimensions.width >= dimensions.height ? 'landscape' : 'portrait', compress: false })
  await svg2pdf(parsed.documentElement, pdf, { x: 0, y: 0, width: dimensions.width, height: dimensions.height })
  return new Uint8Array(pdf.output('arraybuffer'))
}

const wait_for_frame = async (): Promise<void> => {
  if (typeof requestAnimationFrame === 'function') {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  } else await Promise.resolve()
}

const layout_signature = (root: HTMLElement): string => {
  let hash = 2166136261
  let length = 0
  const add = (value: string): void => {
    length += value.length
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
  }
  for (const path of Array.from(root.querySelectorAll<SVGPathElement>('svg path[d]'))) add(path.getAttribute('d') ?? '')
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('svg, canvas, .legend, .color-bar'))) {
    const rect = element.getBoundingClientRect()
    add(`${Math.round(rect.x * 10)},${Math.round(rect.y * 10)},${Math.round(rect.width * 10)},${Math.round(rect.height * 10)};`)
  }
  return `${hash >>> 0}:${length}`
}

const wait_for_stable_layout = async (root: HTMLElement, timeout_ms = 2_000): Promise<void> => {
  const deadline = Date.now() + timeout_ms
  let previous = ''
  let stable = 0
  while (Date.now() < deadline) {
    await wait_for_frame()
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
    const current = layout_signature(root)
    stable = current === previous ? stable + 1 : 0
    if (stable >= 3) return
    previous = current
  }
  throw new Error(`Timed out waiting for the export layout to stabilize (${timeout_ms} ms)`)
}

const with_export_layout = async <T>(root: HTMLElement, dimensions: PlotExportDimensions, action: () => Promise<T>): Promise<T> => {
  const previous_style = root.getAttribute('style')
  root.style.width = `${dimensions.width}px`
  root.style.height = `${dimensions.height}px`
  root.style.minWidth = `${dimensions.width}px`
  root.style.minHeight = `${dimensions.height}px`
  try {
    await wait_for_stable_layout(root)
    return await action()
  } finally {
    if (previous_style === null) root.removeAttribute('style')
    else root.setAttribute('style', previous_style)
  }
}

export const export_plot_document = async (
  root: HTMLElement,
  request: PlotExportRequest,
  options: { endpoint?: URL; fetch?: typeof globalThis.fetch; dimensions?: PlotExportDimensions } = {},
): Promise<Uint8Array> => {
  if (!request.path.trim()) throw new Error('Plot export path must not be empty')
  const requested_dimensions = request.width !== undefined && request.height !== undefined
    ? { width: finite_dimension(request.width, 0), height: finite_dimension(request.height, 0) }
    : plot_export_dimensions(root)
  const dimensions = checked_dimensions(options.dimensions ?? requested_dimensions)
  const bytes = await with_export_layout(root, dimensions, async () => {
    const svg = plot_document_svg(root, dimensions)
    return request.format === 'png' ? rasterize_svg(svg, dimensions) : svg_to_pdf(svg, dimensions)
  })
  // The authenticated host deliberately ignores client paths.  Send only the
  // capability token, preventing path injection and keeping endpoint shape
  // stable across hosts.
  const endpoint = new URL(options.endpoint ?? '/api/plot-export', window.location.href)
  const capability = new URL(window.location.href).searchParams.get('cap')
  endpoint.search = capability ? `?cap=${encodeURIComponent(capability)}` : ''
  const response = await (options.fetch ?? fetch)(endpoint, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': request.format === 'png' ? 'image/png' : 'application/pdf' },
    body: bytes.slice().buffer as ArrayBuffer,
  })
  if (!response.ok) throw new Error(`Plot export request returned HTTP ${response.status}`)
  return bytes
}

export const is_png = (bytes: Uint8Array): boolean => PNG_SIGNATURE.every((value, index) => bytes[index] === value)
export const is_pdf = (bytes: Uint8Array): boolean => new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-'

export const svg_to_png = rasterize_svg

/** Wait for the plot renderer to produce its first scientific SVG.  A bounded
 * wait is important here: the native host must remain alive when rendering
 * fails, instead of waiting forever for a return request. */
export const wait_for_plot_ready = async (
  root: HTMLElement,
  timeout_ms = 15_000,
  poll_ms = 50,
): Promise<void> => {
  const started = Date.now()
  while (true) {
    const loading = root.querySelector('.plot-loading')
    if (!loading && root.querySelector('svg')) return
    if (Date.now() - started >= timeout_ms) {
      throw new Error(`Timed out waiting for the scientific plot to render (${timeout_ms} ms)`)
    }
    await new Promise<void>((resolve) => setTimeout(resolve, poll_ms))
  }
}
