// Match upstream MatterViz's software WebGPU setup for runners without a GPU.
// Generic ANGLE Vulkan needs surface extensions that bundled SwiftShader lacks.
export const chromiumOptions = {
  channel: 'chromium',
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  headless: process.env.PLAYWRIGHT_HEADED !== '1',
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--enable-unsafe-swiftshader',
    '--use-webgpu-adapter=swiftshader',
    '--use-vulkan=swiftshader',
    '--use-angle=swiftshader',
    '--disable-vulkan-surface',
    '--disable-gpu-watchdog',
  ],
}
