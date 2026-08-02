/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MATTERVIZ_PRERELEASE_UPDATER?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module 'd3-contour' {
  export type ContourPolygon = { type: 'MultiPolygon'; value: number; coordinates: number[][][][] }
  export type ContourGenerator = ((values: ArrayLike<number>) => ContourPolygon[]) & { size(size: [number, number]): ContourGenerator; thresholds(values: number[]): ContourGenerator }
  export function contours(): ContourGenerator
}
