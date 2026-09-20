import { normalize_color_stops, type ColorStop } from 'matterviz/colors/stops'
import { trans_flag_color_css } from './esp.ts'

export type ColorScale = { preset: string; stops: ColorStop[] }
// D3 palettes sampled at eighths: presets are editable sRGB control points,
// using the same piecewise interpolation as custom scales and the legend.
export const COLOR_SCALE_PRESETS = [
  { name: 'TransFlag', colors: ['#f5a9b8', '#ffffff', '#5bcefa'] },
  { name: 'Viridis', colors: ['#440154', '#472d7b', '#3b528b', '#2c728e', '#21918c', '#28ae80', '#5ec962', '#addc30', '#fde725'] },
  { name: 'RdBu', colors: ['#67001f', '#b82d35', '#e48268', '#faccb4', '#f2efee', '#bfdceb', '#6bacd0', '#2a71ae', '#053061'] },
  { name: 'Turbo', colors: ['#23171b', '#4569ee', '#26bce1', '#3ff393', '#95fb51', '#ecd12e', '#ff821d', '#cb2f0d', '#900c00'] },
  { name: 'Plasma', colors: ['#0d0887', '#4c02a1', '#7e03a8', '#aa2395', '#cc4778', '#e66c5c', '#f89540', '#fdc527', '#f0f921'] },
  { name: 'Inferno', colors: ['#000004', '#210c4a', '#57106e', '#8a226a', '#bc3754', '#e45a31', '#f98e09', '#f9cb35', '#fcffa4'] },
  { name: 'Magma', colors: ['#000004', '#1d1147', '#51127c', '#832681', '#b73779', '#e75263', '#fc8961', '#fec488', '#fcfdbf'] },
  { name: 'Cividis', colors: ['#002051', '#11366c', '#3c4d6e', '#62646f', '#7f7c75', '#9a9478', '#bbaf71', '#e2cb5c', '#fdea45'] },
  { name: 'RdYlBu', colors: ['#a50026', '#dd4030', '#f88d52', '#fed284', '#faf8c1', '#d1ebef', '#90c2dd', '#5382bb', '#313695'] },
  { name: 'Spectral', colors: ['#9e0142', '#db494a', '#f88e53', '#fed281', '#fbf8b0', '#d5ee9f', '#89cfa5', '#4696b3', '#5e4fa2'] },
  { name: 'PiYG', colors: ['#8e0152', '#c9378a', '#e795c3', '#f9d4e9', '#f5f3ef', '#d8efbb', '#9bce64', '#5a9c2b', '#276419'] },
  { name: 'BrBG', colors: ['#543005', '#985e15', '#cea156', '#efddb0', '#eef1ea', '#b3e1db', '#5bb2a8', '#12736a', '#003c30'] },
  { name: 'PuOr', colors: ['#2d004b', '#5f3d8f', '#998ebf', '#cecde4', '#f3eeea', '#fdd5a0', '#ee9d3d', '#be630b', '#7f3b08'] },
  { name: 'Cool', colors: ['#6e40aa', '#5c5ace', '#417de0', '#27a3dc', '#1ac7c2', '#21e39b', '#40f373', '#73f65a', '#aff05b'] },
  { name: 'Warm', colors: ['#6e40aa', '#a03db3', '#d23ea7', '#f9488a', '#ff5e63', '#ff7f41', '#efa72f', '#cdcf37', '#aff05b'] },
  { name: 'RdYlGn', colors: ['#a50026', '#dd4030', '#f88d52', '#fed281', '#f9f7ae', '#cbe984', '#85cb67', '#30a054', '#006837'] },
  { name: 'Greys', colors: ['#ffffff', '#efefef', '#d8d8d8', '#bbbbbb', '#979797', '#737373', '#505050', '#262626', '#000000'] },
]

export const preset_color_scale = (name: string): ColorScale => {
  const preset = COLOR_SCALE_PRESETS.find((item) => `interpolate${item.name}` === name) ?? COLOR_SCALE_PRESETS[1]
  return { preset: `interpolate${preset.name}`, stops: preset.colors.map((color, index) => ({ color, position: index / (preset.colors.length - 1) })) }
}

export const normalize_color_scale = (value: unknown): ColorScale => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid color scale')
  const row = value as Record<string, unknown>, stops = normalize_color_stops(row.stops)
  const preset = typeof row.preset === 'string' && COLOR_SCALE_PRESETS.some((item) => `interpolate${item.name}` === row.preset) ? row.preset : 'custom'
  // A named preset must describe the actual points; edited/imported points are custom.
  const expected = preset_color_scale(preset).stops
  return { preset: preset !== 'custom' && expected.length === stops.length && stops.every((stop, index) => stop.position === expected[index].position && stop.color === expected[index].color) ? preset : 'custom', stops }
}

/** Preserve physical-zero anchoring when migrating the old pink/white/blue map. */
export const legacy_color_scale = (colormap = 'interpolateViridis', range?: [number, number]): ColorScale => {
  const scale = preset_color_scale(colormap)
  if (colormap !== 'interpolateTransFlag' || !range || !range.every(Number.isFinite)) return scale
  const [lower, upper] = [...range].sort((a, b) => a - b)
  const positions = lower < 0 && upper > 0 ? [0, -lower / (upper - lower), 1] : [0, 1]
  return normalize_color_scale({ preset: scale.preset, stops: positions.map((position) => ({ position, color: trans_flag_color_css(lower + position * (upper - lower), lower, upper) })) })
}

export const volume_color_scale = (volume: { colorScale?: ColorScale; colormap?: string; color_range?: [number, number]; color_stops?: ColorStop[] }): ColorScale =>
  volume.colorScale ?? (volume.color_stops ? normalize_color_scale({ stops: volume.color_stops }) : legacy_color_scale(volume.colormap, volume.color_range))
