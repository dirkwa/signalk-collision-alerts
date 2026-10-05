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
  const linked = new Map<string, Array<[string, SensorTargetNode]>>()
  for (const [id, node] of Object.entries(targets)) {
    const sameAs = node.sameAs?.value
    if (typeof sameAs === 'string') {
      linked.set(sameAs, [...(linked.get(sameAs) ?? []), [id, node]])
    }
  }
  const sourcesOf = (context: string) => (linked.get(context) ?? []).map(([id]) => typeOf(id))
  const membersOf = (context: string) => (linked.get(context) ?? []).map(([, node]) => node)

  const nodes: Record<string, TargetNode> = {}
  for (const [id, vessel] of Object.entries(vessels)) {
    const context = `vessels.${id}`
    const sources = sourcesOf(context)
    nodes[id] =
      sources.length === 0
        ? vessel
        : {
            ...vessel,
            navigation: freshest([vessel, ...membersOf(context)]),
            sources: ['ais', ...sources]
          }
  }
  for (const [id, target] of Object.entries(targets)) {
    if (typeof target.sameAs?.value === 'string') {
      continue
    }
    const context = `targets.${id}`
    const type = typeOf(id)
    nodes[id] = {
      name: target.name ?? `${type} target ${id.slice(type.length + 1)}`,
      ...(target.mmsi !== undefined && { mmsi: target.mmsi }),
      navigation: freshest([target, ...membersOf(context)]),
      context,
      targetRef: context,
      source: type,
      sources: [type, ...sourcesOf(context)]
    }
  }
  return nodes
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
