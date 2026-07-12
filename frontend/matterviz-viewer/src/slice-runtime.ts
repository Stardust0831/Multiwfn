import { sample_hkl_slice, type VolumetricData } from 'matterviz'
import { sample_slice_with, type NormalizedSlice } from './slice'

export const sample_slice = (
  volume: VolumetricData | undefined,
  miller_indices: unknown,
  distance: unknown,
  resolution?: unknown,
): NormalizedSlice | null => sample_slice_with(
  sample_hkl_slice,
  volume,
  miller_indices,
  distance,
  resolution,
)
