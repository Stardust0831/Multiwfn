import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
import { fileURLToPath } from 'node:url'

test('every async native export accepts an instance sink and returns Promise<void> to typed consumers', () => {
  const filename = fileURLToPath(new URL('../.dev-cache/export-consumer.ts', import.meta.url))
  const source = `
    import { export_structure_as, export_structure_as_glb, export_structure_as_obj } from '../node_modules/matterviz/dist/structure/export';
    import { export_canvas_as_png, export_trajectory_video, type DownloadCallback } from 'matterviz/io';
    import type { Scene } from 'three';
    declare const scene: Scene;
    declare const canvas: HTMLCanvasElement;
    const sink: DownloadCallback = async (data: Blob | string, filename: string, mime: string) => {};
    const work: Promise<void>[] = [
      export_structure_as('xyz', undefined, sink),
      export_structure_as_glb(scene, undefined, sink),
      export_structure_as_obj(scene, undefined, sink),
      export_canvas_as_png(canvas, 'frame.png', 72, null, null, sink),
      export_trajectory_video(canvas, 'frames.webm', { on_download: sink, on_step: async () => {} }),
    ];
    void work;
  `
  const options: ts.CompilerOptions = { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler }
  const host = ts.createCompilerHost(options), originalSource = host.getSourceFile, originalExists = host.fileExists, originalRead = host.readFile
  host.fileExists = path => path === filename || originalExists(path)
  host.readFile = path => path === filename ? source : originalRead(path)
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) => path === filename ? ts.createSourceFile(path, source, languageVersion) : originalSource(path, languageVersion, onError, shouldCreateNewSourceFile)
  const program = ts.createProgram([filename], options, host)
  const diagnostics = ts.getPreEmitDiagnostics(program)
  assert.deepEqual(diagnostics.map(diagnostic => `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`), [])
})
