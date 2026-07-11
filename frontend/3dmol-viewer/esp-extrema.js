(function exposeEspExtrema(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MultiwfnEspExtrema = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const KCAL_PER_HARTREE = 627.5094740631;
  const CORNER_OFFSETS = Object.freeze([
    [0, 0, 0],
    [0, 0, 1],
    [0, 1, 0],
    [0, 1, 1],
    [1, 0, 0],
    [1, 0, 1],
    [1, 1, 0],
    [1, 1, 1]
  ]);
  const EDGE_CORNERS = Object.freeze([
    [0, 1],
    [1, 3],
    [3, 2],
    [2, 0],
    [4, 5],
    [5, 7],
    [7, 6],
    [6, 4],
    [0, 4],
    [1, 5],
    [3, 7],
    [2, 6]
  ]);

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function volumeShape(volume) {
    return [Number(volume?.size?.x), Number(volume?.size?.y), Number(volume?.size?.z)];
  }

  function expectedVolumeLength(volume) {
    const shape = volumeShape(volume);
    if (!shape.every((value) => Number.isInteger(value) && value > 0)) return 0;
    return shape.reduce((product, value) => product * value, 1);
  }

  function assertCompatibleVolumes(density, esp) {
    const densityShape = volumeShape(density);
    const espShape = volumeShape(esp);
    const expected = expectedVolumeLength(density);
    if (!expected || densityShape.some((value, index) => value !== espShape[index])) {
      throw new Error('Density and ESP cube dimensions do not match');
    }
    if (density?.data?.length < expected || esp?.data?.length < expected) {
      throw new Error('Density or ESP cube data is incomplete');
    }
  }

  function matrixElements(volume) {
    const elements = volume?.matrixElements || volume?.matrix?.elements;
    return elements && elements.length === 16 ? elements : null;
  }

  function gridPointToWorld(volume, x, y, z) {
    const elements = matrixElements(volume);
    if (elements) {
      const denominator = elements[3] * x + elements[7] * y + elements[11] * z + elements[15];
      const scale = denominator ? 1 / denominator : 1;
      return {
        x: (elements[0] * x + elements[4] * y + elements[8] * z + elements[12]) * scale,
        y: (elements[1] * x + elements[5] * y + elements[9] * z + elements[13]) * scale,
        z: (elements[2] * x + elements[6] * y + elements[10] * z + elements[14]) * scale
      };
    }
    return {
      x: Number(volume?.origin?.x || 0) + Number(volume?.unit?.x || 1) * x,
      y: Number(volume?.origin?.y || 0) + Number(volume?.unit?.y || 1) * y,
      z: Number(volume?.origin?.z || 0) + Number(volume?.unit?.z || 1) * z
    };
  }

  function buildInterpolatedIsosurface(density, esp, isovalue, options = {}) {
    assertCompatibleVolumes(density, esp);
    const iso = Number(isovalue);
    if (!Number.isFinite(iso) || iso <= 0) throw new Error('Density isovalue must be positive');
    const triTable = options.triTable;
    if (!triTable || triTable.length < 256) throw new Error('A complete marching-cubes triangle table is required');

    const [nx, ny, nz] = volumeShape(density);
    const densityData = density.data;
    const espData = esp.data;
    const pointCount = nx * ny * nz;
    const index = (x, y, z) => (x * ny + y) * nz + z;
    const maximumBoundaryMargin = Math.max(0, Math.floor((Math.min(nx, ny, nz) - 2) / 2));
    const boundaryMargin = clamp(
      Number.isFinite(Number(options.boundaryMargin)) ? Math.floor(Number(options.boundaryMargin)) : 1,
      0,
      maximumBoundaryMargin
    );
    const vertices = [];
    const faces = [];
    const edgeVertices = new Map();

    for (let x = 0; x < nx - 1; x += 1) {
      for (let y = 0; y < ny - 1; y += 1) {
        for (let z = 0; z < nz - 1; z += 1) {
          const cornerIndices = CORNER_OFFSETS.map((offset) => (
            index(x + offset[0], y + offset[1], z + offset[2])
          ));
          let cubeIndex = 0;
          for (let corner = 0; corner < 8; corner += 1) {
            if (Number(densityData[cornerIndices[corner]]) > iso) cubeIndex |= 1 << corner;
          }
          if (cubeIndex === 0 || cubeIndex === 255) continue;
          const triangles = triTable[cubeIndex];
          if (!triangles?.length) continue;

          const vertexForEdge = (edgeIndex) => {
            const pair = EDGE_CORNERS[edgeIndex];
            if (!pair) throw new Error(`Unsupported marching-cubes edge ${edgeIndex}`);
            const firstIndex = cornerIndices[pair[0]];
            const secondIndex = cornerIndices[pair[1]];
            const low = Math.min(firstIndex, secondIndex);
            const high = Math.max(firstIndex, secondIndex);
            const edgeKey = low * pointCount + high;
            if (edgeVertices.has(edgeKey)) return edgeVertices.get(edgeKey);

            const firstOffset = CORNER_OFFSETS[pair[0]];
            const secondOffset = CORNER_OFFSETS[pair[1]];
            const firstDensity = Number(densityData[firstIndex]);
            const secondDensity = Number(densityData[secondIndex]);
            const denominator = secondDensity - firstDensity;
            const fraction = clamp(denominator ? (iso - firstDensity) / denominator : 0.5, 0, 1);
            const gridX = x + firstOffset[0] + fraction * (secondOffset[0] - firstOffset[0]);
            const gridY = y + firstOffset[1] + fraction * (secondOffset[1] - firstOffset[1]);
            const gridZ = z + firstOffset[2] + fraction * (secondOffset[2] - firstOffset[2]);
            const position = gridPointToWorld(density, gridX, gridY, gridZ);
            const firstEsp = Number(espData[firstIndex]);
            const secondEsp = Number(espData[secondIndex]);
            const value = firstEsp + fraction * (secondEsp - firstEsp);
            const boundary = (
              gridX <= boundaryMargin || gridX >= nx - 1 - boundaryMargin
              || gridY <= boundaryMargin || gridY >= ny - 1 - boundaryMargin
              || gridZ <= boundaryMargin || gridZ >= nz - 1 - boundaryMargin
            );
            const vertexIndex = vertices.length;
            vertices.push({ ...position, value, boundary });
            edgeVertices.set(edgeKey, vertexIndex);
            return vertexIndex;
          };

          for (let offset = 0; offset + 2 < triangles.length; offset += 3) {
            const first = vertexForEdge(Number(triangles[offset]));
            const second = vertexForEdge(Number(triangles[offset + 1]));
            const third = vertexForEdge(Number(triangles[offset + 2]));
            if (first === second || second === third || first === third) continue;
            faces.push(first, second, third);
          }
        }
      }
    }
    return { vertices, faces };
  }

  function buildSurfaceAdjacency(vertexCount, faces) {
    const adjacency = Array.from({ length: Math.max(0, Number(vertexCount) || 0) }, () => new Set());
    const connect = (first, second) => {
      if (first === second || !adjacency[first] || !adjacency[second]) return;
      adjacency[first].add(second);
      adjacency[second].add(first);
    };
    for (let offset = 0; offset + 2 < faces.length; offset += 3) {
      const first = Number(faces[offset]);
      const second = Number(faces[offset + 1]);
      const third = Number(faces[offset + 2]);
      connect(first, second);
      connect(second, third);
      connect(third, first);
    }
    return adjacency;
  }

  function findSurfaceExtrema(vertices, faces, options = {}) {
    const adjacency = buildSurfaceAdjacency(vertices.length, faces);
    const epsilon = Math.max(0, Number(options.epsilon) || 1e-12);
    const finiteIndices = vertices
      .map((vertex, index) => (Number.isFinite(Number(vertex?.value)) ? index : -1))
      .filter((index) => index >= 0);
    if (!finiteIndices.length) return { minima: [], maxima: [] };

    const neighbourhoods = adjacency.map((directNeighbours, index) => {
      const neighbours = new Set(directNeighbours);
      directNeighbours.forEach((directIndex) => {
        adjacency[directIndex].forEach((secondaryIndex) => {
          if (secondaryIndex !== index) neighbours.add(secondaryIndex);
        });
      });
      return neighbours;
    });
    const excludeBoundary = options.excludeBoundary !== false;
    const eligibleIndices = finiteIndices.filter((index) => {
      if (!excludeBoundary) return true;
      if (vertices[index]?.boundary) return false;
      return ![...neighbourhoods[index]].some((neighbourIndex) => vertices[neighbourIndex]?.boundary);
    });
    const boundaryFiltered = finiteIndices.length - eligibleIndices.length;
    if (!eligibleIndices.length) return { minima: [], maxima: [], boundaryFiltered };

    let globalMinimumIndex = eligibleIndices[0];
    let globalMaximumIndex = eligibleIndices[0];
    eligibleIndices.forEach((index) => {
      if (Number(vertices[index].value) < Number(vertices[globalMinimumIndex].value)) globalMinimumIndex = index;
      if (Number(vertices[index].value) > Number(vertices[globalMaximumIndex].value)) globalMaximumIndex = index;
    });

    const minimumIndices = [];
    const maximumIndices = [];
    eligibleIndices.forEach((index) => {
      if (!adjacency[index].size) return;
      const neighbours = neighbourhoods[index];
      const value = Number(vertices[index].value);
      let isMinimum = true;
      let isMaximum = true;
      neighbours.forEach((neighbourIndex) => {
        const neighbourValue = Number(vertices[neighbourIndex]?.value);
        if (!Number.isFinite(neighbourValue)) return;
        if (value >= neighbourValue - epsilon) isMinimum = false;
        if (value <= neighbourValue + epsilon) isMaximum = false;
      });
      if (isMinimum) minimumIndices.push(index);
      if (isMaximum) maximumIndices.push(index);
    });

    if (!minimumIndices.includes(globalMinimumIndex)) minimumIndices.push(globalMinimumIndex);
    if (!maximumIndices.includes(globalMaximumIndex)) maximumIndices.push(globalMaximumIndex);
    minimumIndices.sort((left, right) => Number(vertices[left].value) - Number(vertices[right].value) || left - right);
    maximumIndices.sort((left, right) => Number(vertices[right].value) - Number(vertices[left].value) || left - right);

    const format = (index, type, rank, globalIndex) => {
      const vertex = vertices[index];
      const value = Number(vertex.value);
      return {
        id: `${type === 'minimum' ? 'min' : 'max'}-${rank}`,
        type,
        rank,
        global: index === globalIndex,
        x: Number(vertex.x),
        y: Number(vertex.y),
        z: Number(vertex.z),
        value,
        kcalMol: value * KCAL_PER_HARTREE
      };
    };
    return {
      minima: minimumIndices.map((index, rank) => format(index, 'minimum', rank + 1, globalMinimumIndex)),
      maxima: maximumIndices.map((index, rank) => format(index, 'maximum', rank + 1, globalMaximumIndex)),
      boundaryFiltered
    };
  }

  function analyzeEspExtrema(density, esp, isovalue, options = {}) {
    const mesh = buildInterpolatedIsosurface(density, esp, isovalue, options);
    const extrema = findSurfaceExtrema(mesh.vertices, mesh.faces, options);
    return {
      ...extrema,
      vertexCount: mesh.vertices.length,
      triangleCount: Math.floor(mesh.faces.length / 3)
    };
  }

  function extremaCacheKey(sessionGeneration, quality, isovalue) {
    const iso = Number(isovalue);
    return `${Number(sessionGeneration) || 0}:${Number(quality) || 0}:${Number.isFinite(iso) ? iso.toPrecision(12) : 'invalid'}`;
  }

  return Object.freeze({
    KCAL_PER_HARTREE,
    CORNER_OFFSETS,
    EDGE_CORNERS,
    analyzeEspExtrema,
    assertCompatibleVolumes,
    buildInterpolatedIsosurface,
    buildSurfaceAdjacency,
    extremaCacheKey,
    findSurfaceExtrema,
    gridPointToWorld
  });
}));
