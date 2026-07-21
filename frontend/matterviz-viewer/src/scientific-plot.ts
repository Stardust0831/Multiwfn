export const SCIENTIFIC_PLOT_PADDING = { t: 10, b: 55, l: 60, r: 170 }

export const SCIENTIFIC_PLOT_LEGEND = {
  draggable: false,
  responsive: true,
  style: 'left: auto; right: 8px; top: 42px;',
}

const SERIES_COLORS = ['#4e79a7', '#f28e2c', '#e15759', '#76b7b2', '#59a14f', '#edc949', '#af7aa1', '#ff9da7', '#9c755f', '#bab0ab']

export const scientific_series_color = (color: string | undefined, index: number): string =>
  color ?? SERIES_COLORS[index % SERIES_COLORS.length]
