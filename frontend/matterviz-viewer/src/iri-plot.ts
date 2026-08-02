export const IRI_COLOR_RANGE: [number, number] = [-0.04, 0.02]

const interpolate_channel = (start: number, end: number, fraction: number): number =>
  Math.round(start + (end - start) * fraction)

const interpolate_rgb = (
  start: [number, number, number],
  end: [number, number, number],
  fraction: number,
): string => `rgb(${start.map((value, index) => interpolate_channel(value, end[index], fraction)).join(', ')})`

/** Official Multiwfn IRIscatter.gnu palette: blue at -0.04, green at 0,
 * red at 0.02, with endpoint clipping. */
export const iri_interaction_color = (value: number): string => {
  const clamped = Math.max(IRI_COLOR_RANGE[0], Math.min(IRI_COLOR_RANGE[1], value))
  if (clamped <= 0) return interpolate_rgb([0, 0, 255], [0, 255, 0], (clamped + 0.04) / 0.04)
  return interpolate_rgb([0, 255, 0], [255, 0, 0], clamped / 0.02)
}
