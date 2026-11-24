import { canvas_to_png_blob, scene_registry } from 'matterviz/io'

export const scene_to_png_blob = async (canvas: HTMLCanvasElement, background?: string): Promise<Blob> => {
  if (!scene_registry.has(canvas)) throw new Error('The 3D renderer is not ready for export')
  return with_png_background(await canvas_to_png_blob(canvas, 150), background)
}

// The viewports use CSS backgrounds. Composite the selected color into opaque exports.
export const with_png_background = async (blob: Blob, background?: string): Promise<Blob> => {
  if (background === undefined) return blob

  const image = await createImageBitmap(blob)
  try {
    const output = document.createElement('canvas')
    output.width = image.width
    output.height = image.height
    const context = output.getContext('2d')
    if (!context) throw new Error('Canvas 2D context is unavailable')
    context.fillStyle = background
    context.fillRect(0, 0, output.width, output.height)
    context.drawImage(image, 0, 0)
    return await new Promise<Blob>((resolve, reject) => output.toBlob(
      (result) => result ? resolve(result) : reject(new Error('Unable to encode scene PNG')),
      'image/png',
    ))
  } finally {
    image.close()
  }
}
