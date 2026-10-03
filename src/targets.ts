import type { TargetNode } from './evaluator.js'

/**
 * A target from the Signal K Targets API (`app.getTargets()`): one boat, with
 * the AIS vessel and every sensor contact that sees it already merged by the
 * server. Mirrored here because the API is newer than the
 * `@signalk/server-api` this plugin builds against.
 */
export interface Target {
  id: string
  context?: string
  name?: string
  mmsi?: string
  position: { latitude: number; longitude: number }
  courseOverGroundTrue?: number
  speedOverGround?: number
  timestamp: string
  sources: Array<{ type: string; id: string; ref?: string }>
}

/** The Targets API on `app`, absent on servers that predate it. */
export interface TargetsHost {
  getTargets?: () => Target[]
}

/**
 * The server's targets in the shape the evaluator reads, keyed by target id.
 *
 * The alarm points at the AIS vessel when there is one, so Freeboard finds it
 * as before; otherwise at the sensor's own record of the target (a radar
 * target path), which is what that sensor's own alarm pointed at.
 */
export function targetNodes(targets: Target[]): Record<string, TargetNode> {
  const nodes: Record<string, TargetNode> = {}
  for (const target of targets) {
    const sensor = target.sources.find((s) => s.type !== 'ais') ?? target.sources.at(0)
    const leaf = <T>(value: T | undefined) =>
      value === undefined ? undefined : { value, timestamp: target.timestamp }
    nodes[target.id] = {
      name:
        target.name ?? (target.mmsi || !sensor ? undefined : `${sensor.type} target ${sensor.id}`),
      mmsi: target.mmsi,
      navigation: {
        position: leaf(target.position),
        courseOverGroundTrue: leaf(target.courseOverGroundTrue),
        speedOverGround: leaf(target.speedOverGround)
      },
      context: target.context ?? null,
      targetRef: target.context ?? sensor?.ref ?? `targets.${target.id}`,
      source: target.context ? 'ais' : (sensor?.type ?? 'unknown'),
      sources: target.sources.map((s) => s.type)
    }
  }
  return nodes
}
