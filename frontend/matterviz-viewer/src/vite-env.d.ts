/// <reference types="vite/client" />

declare module 'd3-contour' {
  export type ContourPolygon = { type: 'MultiPolygon'; value: number; coordinates: number[][][][] }
  export type ContourGenerator = ((values: ArrayLike<number>) => ContourPolygon[]) & { size(size: [number, number]): ContourGenerator; thresholds(values: number[]): ContourGenerator }
  export function contours(): ContourGenerator
}
