import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const vendor = fileURLToPath(new URL('../vendor/', import.meta.url))
const version = 'matterviz-0.4.2-multiwfn.d8719d12.r25'
const tree = async (root: string): Promise<Record<string, string>> => {
  const files: Record<string, string> = {}
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name)
      files[relative(root, path)] = createHash('sha256').update(await readFile(path)).digest('hex')
    }
  }
  return files
}

test('freq2 is an exact, allowlisted layer on retained byte-identical freq1, never a global download override', async () => {
  const root = await mkdtemp(join(tmpdir(), 'frequency-export-replay-'))
  try {
    const base = join(root, 'base'), target = join(root, 'target')
    await mkdir(base); await mkdir(target)
    execFileSync('tar', ['-xzf', join(vendor, `${version}.freq1.tgz`), '-C', base])
    execFileSync('tar', ['-xzf', join(vendor, `${version}.freq2.tgz`), '-C', target])
    const before = await tree(base)
    execFileSync('patch', ['--batch', '-p1', '-d', join(base, 'package')], { input: await readFile(join(vendor, 'patches', `${version}.freq2.patch`)) })
    const after = await tree(base)
    assert.deepEqual(after, await tree(target))
    assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), 'no new runtime, dependency or helper package')
    assert.deepEqual(Object.keys(before).filter(path => before[path] !== after[path]).sort(), [
      'package/package.json',
      'package/dist/io/export.js', 'package/dist/io/export.d.ts',
      'package/dist/structure/index.js', 'package/dist/structure/index.d.ts',
      'package/dist/structure/export.js', 'package/dist/structure/export.d.ts',
      'package/dist/structure/Structure.svelte', 'package/dist/structure/Structure.svelte.d.ts',
      'package/dist/structure/StructureExportPane.svelte', 'package/dist/structure/StructureExportPane.svelte.d.ts',
      'package/dist/trajectory/Trajectory.svelte', 'package/dist/trajectory/Trajectory.svelte.d.ts',
      'package/dist/trajectory/TrajectoryExportPane.svelte', 'package/dist/trajectory/TrajectoryExportPane.svelte.d.ts',
    ].sort())
    assert.equal(after['package/dist/io/fetch.js'], before['package/dist/io/fetch.js'])
    const archive = await readFile(join(vendor, `${version}.freq2.tgz`))
    const integrity = `sha512-${createHash('sha512').update(archive).digest('base64')}`
    assert.ok((await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')).includes(`integrity: ${integrity}, tarball: file:vendor/${version}.freq2.tgz`))
    const installed = await tree(fileURLToPath(new URL('../node_modules/matterviz/', import.meta.url)))
    const packaged = await tree(join(target, 'package'))
    for (const [path, digest] of Object.entries(packaged)) assert.equal(installed[path], digest, `installed ${path}`)
  } finally { await rm(root, { recursive: true, force: true }) }
})
