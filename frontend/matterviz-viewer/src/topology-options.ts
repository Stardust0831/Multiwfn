import type { AimOptions } from './topology'

export const AIM_NUMBER_FIELDS = [
  { key: 'distance', label: 'Distance factor', min: 0.1, max: 5, step: 0.1 },
  { key: 'gradient', label: 'Gradient threshold (a.u.)', min: 1e-12, max: 1e-2, step: 'any' },
  { key: 'displacement', label: 'Displacement (Bohr)', min: 1e-12, max: 1e-2, step: 'any' },
  { key: 'cycles', label: 'Maximum iterations', min: 1, max: 1000, step: 1 },
  { key: 'step', label: 'Path step (Bohr)', min: 1e-4, max: 0.2, step: 0.005 },
  { key: 'pathPoints', label: 'Maximum path points', min: 3, max: 1499, step: 1 },
] as const satisfies ReadonlyArray<{ key: keyof AimOptions; label: string; min: number; max: number; step: number | 'any' }>

export type AimNumberField = typeof AIM_NUMBER_FIELDS[number]

export const valid_aim_number = (field: AimNumberField, value: number): boolean =>
  Number.isFinite(value) && value >= field.min && value <= field.max
  && (field.step !== 1 || Number.isInteger(value))

export const aim_number_error = (field: AimNumberField): string =>
  `${field.label} must be ${field.step === 1 ? 'a whole number' : 'a number'} from ${field.min} to ${field.max}.`
