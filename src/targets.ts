import type { TargetNode, VesselNode } from './evaluator.js'

/**
 * A `targets.<type>:<id>` context: an object a radar or camera tracks, in the
 * server's sensor-targets convention. `sameAs`, set by a fusion plugin, names
 * the context (AIS vessel or other target) it is the same object as.
 */
export interface SensorTargetNode extends VesselNode {
  sameAs?: { value?: unknown }
}

type Navigation = NonNullable<VesselNode['navigation']>

/**
 * AIS vessels and sensor targets as one object each, keyed by target id.
 *
 * A target linked to another context is folded into that object, so a boat
 * seen on AIS and radar raises one alarm. The object moves with whichever of
 * its members reported most recently: radar keeps tracking a boat whose AIS
 * fell silent. An object no AIS vessel names is keyed by its target's id,
 * e.g. `radar:nav1034A-17`.
 */
export function targetNodes(
  vessels: Record<string, VesselNode>,
  targets: Record<string, SensorTargetNode> = {}
): Record<string, TargetNode> {
  const members = new Map<string, Array<[string, SensorTargetNode]>>()
  const roots = new Set<string>()
  for (const [id, node] of Object.entries(targets)) {
    const root = rootOf(id, vessels, targets)
    if (root === `targets.${id}`) {
      roots.add(id)
    } else {
      members.set(root, [...(members.get(root) ?? []), [id, node]])
    }
  }
  const sourcesOf = (context: string) => (members.get(context) ?? []).map(([id]) => typeOf(id))
  const nodesOf = (context: string) => (members.get(context) ?? []).map(([, node]) => node)

  const nodes: Record<string, TargetNode> = {}
  for (const [id, vessel] of Object.entries(vessels)) {
    const context = `vessels.${id}`
    const sources = sourcesOf(context)
    nodes[id] =
      sources.length === 0
        ? vessel
        : {
            ...vessel,
            navigation: freshest([vessel, ...nodesOf(context)]),
            sources: ['ais', ...sources]
          }
  }
  for (const id of roots) {
    const target = targets[id]
    const context = `targets.${id}`
    const type = typeOf(id)
    nodes[id] = {
      name: target.name ?? `${type} target ${id.slice(type.length + 1)}`,
      ...(target.mmsi !== undefined && { mmsi: target.mmsi }),
      navigation: freshest([target, ...nodesOf(context)]),
      context,
      targetRef: context,
      source: type,
      sources: [type, ...sourcesOf(context)]
    }
  }
  return nodes
}

/**
 * The context that names the object a target belongs to. Links are meant to
 * point straight at it, but a target is never dropped for a link that does
 * not: a chain is followed to its end, and a link to a context that is gone
 * (or a loop) leaves the last target reached as the object, so its sensor
 * still raises the alarm.
 */
function rootOf(
  id: string,
  vessels: Record<string, VesselNode>,
  targets: Record<string, SensorTargetNode>
): string {
  const visited: string[] = []
  let current = id
  for (;;) {
    visited.push(current)
    const sameAs = targets[current].sameAs?.value
    if (typeof sameAs !== 'string') {
      return `targets.${current}`
    }
    const vesselId = sameAs.startsWith('vessels.') ? sameAs.slice('vessels.'.length) : undefined
    if (vesselId !== undefined && Object.hasOwn(vessels, vesselId)) {
      return sameAs
    }
    const next = sameAs.startsWith('targets.') ? sameAs.slice('targets.'.length) : undefined
    if (next === undefined || !Object.hasOwn(targets, next)) {
      return `targets.${current}`
    }
    const loop = visited.indexOf(next)
    if (loop !== -1) {
      // Every target on the loop must agree on one object.
      return `targets.${visited.slice(loop).sort()[0]}`
    }
    current = next
  }
}

function typeOf(targetId: string): string {
  return targetId.split(':')[0]
}

/** The navigation of whichever node has the most recent position. */
function freshest(nodes: VesselNode[]): Navigation {
  let best: Navigation = {}
  let bestMs = -Infinity
  for (const { navigation } of nodes) {
    const timeMs = Date.parse(navigation?.position?.timestamp ?? '')
    if (navigation?.position?.value && timeMs > bestMs) {
      best = navigation
      bestMs = timeMs
    }
  }
  return best
}
