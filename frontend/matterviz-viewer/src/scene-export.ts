import { canvas_to_png_blob, scene_registry } from 'matterviz'

/** MatterViz displays the background with CSS; its WebGL canvas is transparent.
 * Composite a solid background only in the saved image, leaving the live scene,
 * camera, and translucent Rep materials unchanged. Omit it to keep PNG alpha. */
export const scene_to_png_blob = async (canvas: HTMLCanvasElement, background?: string): Promise<Blob> => {
  const scene = scene_registry.get(canvas)
  if (!scene) throw new Error('The 3D renderer is not ready for export')
  const blob = await canvas_to_png_blob(canvas, 150, scene.scene, scene.camera)
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
