import { computeCpa, type CpaResult, type Track } from './cpa.js'
import type { AlarmSink, CollisionAlert } from './alarms.js'
import { assess, type AlertLevel, type Zone } from './zones.js'

/** The fields of a vessel node in the Signal K full data model that we read. */
export interface VesselNode {
  name?: string
  mmsi?: string
  navigation?: {
    // Values come from the network as-is, so their shape is checked, not assumed.
    position?: { value?: { latitude?: unknown; longitude?: unknown } | null; timestamp?: string }
    courseOverGroundTrue?: { value?: number | null; timestamp?: string }
    speedOverGround?: { value?: number | null; timestamp?: string }
  }
}

/**
 * A vessel node, or a target from the server's Targets API dressed as one.
 * The extra fields default to an AIS vessel's.
 */
export interface TargetNode extends VesselNode {
  /** Vessel context; `null` for a target no AIS vessel is part of. */
  context?: string | null
  /** Signal K path the alarm points at. */
  targetRef?: string
  source?: string
  /** Sensor kinds that see the target, when the server merged several. */
  sources?: string[]
}

export interface EvaluatorOptions {
  zones: Zone[]
  /** Targets farther away than this (metres) are not evaluated. */
  maxRange: number
  /** Data older than this (seconds) is ignored. */
  maxAge: number
}

export interface Evaluation {
  targetId: string
  /** Vessel context to publish `navigation.closestApproach` on, if any. */
  context?: string
  result: CpaResult | null
}

// Below this speed COG is noise (and AIS often reports 360° = unavailable),
// so the vessel is treated as stationary.
const STATIONARY_SPEED = 0.1

export function toTrack(node: VesselNode | undefined, nowMs: number, maxAge: number): Track | null {
  const nav = node?.navigation
  if (!nav?.position || !nav.speedOverGround) {
    return null
  }
  const { latitude, longitude } = nav.position.value ?? {}
  const sog = nav.speedOverGround.value
  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    typeof sog !== 'number' ||
    isStale(nav.position.timestamp, nowMs, maxAge) ||
    isStale(nav.speedOverGround.timestamp, nowMs, maxAge)
  ) {
    return null
  }
  const position = { latitude, longitude }
  if (sog < STATIONARY_SPEED) {
    return { position, sog: 0, cog: 0 }
  }
  const cog = nav.courseOverGroundTrue?.value
  if (typeof cog !== 'number' || isStale(nav.courseOverGroundTrue?.timestamp, nowMs, maxAge)) {
    return null
  }
  return { position, sog, cog }
}

function isStale(timestamp: string | undefined, nowMs: number, maxAge: number): boolean {
  if (!timestamp) {
    return true
  }
  const t = Date.parse(timestamp)
  return !Number.isFinite(t) || nowMs - t > maxAge * 1000
}

function describe(id: string, node: VesselNode | undefined): string {
  return node?.name ?? (node?.mmsi ? `MMSI ${node.mmsi}` : id)
}

export function formatMessage(name: string, result: CpaResult): string {
  const nm = (result.cpa / 1852).toFixed(2)
  const minutes = Math.max(0, Math.round(result.tcpa / 60))
  return `Collision risk: ${name}, CPA ${nm} NM in ${minutes} min`
}

function contextOf(targetId: string, node: TargetNode | undefined): string | undefined {
  return node?.context === null ? undefined : (node?.context ?? `vessels.${targetId}`)
}

/**
 * Evaluates every target against own ship and drives the alarm sink.
 * Holds the per-target alert level so hysteresis survives between ticks.
 */
export class Evaluator {
  private readonly levels = new Map<string, AlertLevel>()

  constructor(
    private readonly options: EvaluatorOptions,
    private readonly sink: AlarmSink
  ) {}

  /**
   * @param own own ship, or null when its own data is missing/stale
   * @param vessels the `vessels` subtree of the data model, or the server's
   *   targets, keyed by id
   */
  evaluate(
    own: Track | null,
    vessels: Record<string, TargetNode>,
    selfId: string,
    nowMs: number
  ): Evaluation[] {
    const evaluations: Evaluation[] = []
    const seen = new Set<string>()

    for (const [targetId, node] of Object.entries(vessels)) {
      if (targetId === selfId || targetId === 'self') {
        continue
      }
      const target = own ? toTrack(node, nowMs, this.options.maxAge) : null
      const result = own && target ? computeCpa(own, target) : null
      const context = contextOf(targetId, node)
      if (!result || result.range > this.options.maxRange) {
        evaluations.push({ targetId, context, result: null })
        continue
      }
      seen.add(targetId)
      evaluations.push({ targetId, context, result })

      const level = assess(this.options.zones, result.cpa, result.tcpa, this.levels.get(targetId))
      if (level) {
        this.levels.set(targetId, level)
        this.sink.set(targetId, this.alert(targetId, node, level, result))
      } else {
        this.release(targetId)
      }
    }

    for (const targetId of [...this.levels.keys()]) {
      if (!seen.has(targetId)) {
        this.release(targetId)
      }
    }
    return evaluations
  }

  stop(): void {
    this.levels.clear()
    this.sink.clearAll()
  }

  private release(targetId: string): void {
    if (this.levels.delete(targetId)) {
      this.sink.set(targetId, undefined)
    }
  }

  private alert(
    targetId: string,
    node: TargetNode | undefined,
    level: AlertLevel,
    result: CpaResult
  ): CollisionAlert {
    return {
      level,
      message: formatMessage(describe(targetId, node), result),
      data: {
        targetRef: node?.targetRef ?? `vessels.${targetId}`,
        source: node?.source ?? 'ais',
        ...(node?.sources && { sources: node.sources }),
        cpa: result.cpa,
        tcpa: result.tcpa,
        range: result.range,
        cpaPositions: { self: result.ownAtCpa, target: result.targetAtCpa }
      }
    }
  }
}
