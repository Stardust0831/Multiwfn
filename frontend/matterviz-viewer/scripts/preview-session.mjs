import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const publicDir = process.env.PREVIEW_PUBLIC_DIR
if (!publicDir) throw new Error('Set PREVIEW_PUBLIC_DIR to a directory containing session/manifest.json and its data files.')
const port = Number(process.env.PREVIEW_PORT || 5297)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PREVIEW_PORT must be between 1024 and 65535')
const server = await createServer({ root, publicDir: path.resolve(publicDir),
  cacheDir: path.join(os.tmpdir(), `multiwfn-reps-preview-${port}-${Date.now()}`),
  server: { host: '127.0.0.1', port, strictPort: true, watch: { usePolling: true, interval: 1000 } } })
await server.listen()
server.printUrls()
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); process.exit() })
