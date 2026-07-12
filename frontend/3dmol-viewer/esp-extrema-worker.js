'use strict';

self.window = self;
self.document = self.document || {};
self.$3Dmol = self.$3Dmol || {};
importScripts('vendor/3Dmol-min.js', 'esp-extrema.js');

const engine = self['3Dmol'] || self.$3Dmol;

self.addEventListener('message', (event) => {
  const request = event.data || {};
  const startedAt = performance.now();
  try {
    if (!engine?.VolumeData || !engine?.MarchingCube) {
      throw new Error('3Dmol volume or marching-cubes support is unavailable in the worker');
    }
    const density = new engine.VolumeData(String(request.densityCube || ''), 'cube');
    const esp = new engine.VolumeData(String(request.espCube || ''), 'cube');
    const triTable = engine.MarchingCube.triTable2 || engine.MarchingCube.triTable;
    const result = self.MultiwfnEspExtrema.analyzeEspExtrema(
      density,
      esp,
      Number(request.isovalue),
      { triTable }
    );
    self.postMessage({
      requestId: request.requestId,
      ok: true,
      result: {
        ...result,
        elapsedMs: performance.now() - startedAt
      }
    });
  } catch (error) {
    self.postMessage({
      requestId: request.requestId,
      ok: false,
      message: error?.message || 'ESP extrema analysis failed'
    });
  }
});
