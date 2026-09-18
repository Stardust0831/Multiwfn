import type { Sprite } from 'three'
import type { TopologyDisplay, topology_scene_data } from './topology'

export const TOPOLOGY_LABEL_LIMIT = 256
export type TopologyLabel = { key: string; text: string; position: number[] }

/** Share the label budget between visible CPs and paths, including periodic images. */
export const topology_label_targets = (
  data: ReturnType<typeof topology_scene_data>,
  display: Pick<TopologyDisplay, 'labels' | 'cpTypes' | 'pathTypes'>,
): TopologyLabel[] => {
  if (!display.labels) return []
  const targets: TopologyLabel[] = []
  let cpIndex = 0
  let pathIndex = 0
  while (targets.length < TOPOLOGY_LABEL_LIMIT && (cpIndex < data.points.length || pathIndex < data.paths.length)) {
    while (cpIndex < data.points.length && !display.cpTypes[data.points[cpIndex].type]) cpIndex++
    if (cpIndex < data.points.length) {
      const cp = data.points[cpIndex]
      targets.push({ key: `cp:${cpIndex++}`, text: `CP ${cp.id}`, position: cp.position })
    }
    while (pathIndex < data.paths.length && !display.pathTypes[data.paths[pathIndex].type]) pathIndex++
    if (pathIndex < data.paths.length && targets.length < TOPOLOGY_LABEL_LIMIT) {
      const path = data.paths[pathIndex++]
      targets.push({ key: `path:${path.id}`, text: `P ${path.id}`, position: path.points[Math.floor(path.points.length / 2)] })
    }
  }
  return targets
}

/** Retain unchanged labels and dispose removed resources before allocating replacements. */
export const create_topology_labels = (create: (target: TopologyLabel) => Sprite, remove: (sprite: Sprite) => void) => {
  const sprites = new Map<string, Sprite>()
  const sync = (targets: TopologyLabel[]) => {
    const wanted = new Set(targets.map((target) => target.key))
    for (const [key, sprite] of sprites) {
      if (!wanted.has(key)) { remove(sprite); sprites.delete(key) }
    }
    for (const target of targets) {
      if (!sprites.has(target.key)) sprites.set(target.key, create(target))
    }
  }
  return { sync, clear: () => sync([]) }
}
