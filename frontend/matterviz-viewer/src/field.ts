import { contours } from 'd3-contour'
export type FieldContour = { value: number; coordinates: number[][][][] }

/** Marching-squares contour geometry, kept independent of the DOM for tests and workers. */
export const contour_geometry = (z: Float64Array, width: number, height: number, levels: number[]): FieldContour[] => {
  if (width < 2 || height < 2 || z.length !== width * height) throw new Error('Invalid field grid dimensions')
  if (!levels.length) return []
  return contours().size([width, height]).thresholds(levels)(z).map((item) => ({ value: item.value, coordinates: item.coordinates }))
}

export type ReliefCell = { x: number; y: number; width: number; height: number; value: number; opacity: number }
