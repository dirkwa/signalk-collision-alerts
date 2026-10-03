import { describe, expect, it } from 'vitest'
import type { AlarmSink, CollisionAlert } from '../src/alarms.js'
import { Evaluator, toTrack } from '../src/evaluator.js'
import { targetNodes, type Target } from '../src/targets.js'
import { PRESETS } from '../src/zones.js'
import { defined } from './helpers.js'

const NOW = Date.parse('2026-10-03T12:00:00Z')
const timestamp = new Date(NOW - 2000).toISOString()
const VESSEL = 'urn:mrn:imo:mmsi:244060000'
const RADAR_REF = 'vessels.self.radars.radar-0.targets.17'

/** A target one NM north of own ship, coming straight at it. */
function target(overrides: Partial<Target> = {}): Target {
  return {
    id: VESSEL,
    context: `vessels.${VESSEL}`,
    name: 'Nordic Star',
    mmsi: '244060000',
    position: { latitude: 50 + 1 / 60, longitude: 1 },
    courseOverGroundTrue: Math.PI,
    speedOverGround: 5,
    timestamp,
    sources: [
      { type: 'ais', id: VESSEL },
      { type: 'radar', id: 'radar-0:17', ref: RADAR_REF }
    ],
    ...overrides
  }
}

const own = defined(
  toTrack(
    {
      navigation: {
        position: { value: { latitude: 50, longitude: 1 }, timestamp },
        courseOverGroundTrue: { value: 0, timestamp },
        speedOverGround: { value: 5, timestamp }
      }
    },
    NOW,
    360
  )
)

function evaluate(targets: Target[]) {
  const raised: Array<[string, CollisionAlert | undefined]> = []
  const sink: AlarmSink = {
    set: (id, alert) => raised.push([id, alert]),
    clearAll: () => undefined
  }
  const evaluations = new Evaluator(
    { zones: PRESETS.coastal, maxRange: 12 * 1852, maxAge: 360 },
    sink
  ).evaluate(own, targetNodes(targets), 'self', NOW)
  return { raised, evaluations }
}

describe('evaluating server targets', () => {
  it('raises one alarm for a boat seen on AIS and radar, pointing at the AIS vessel', () => {
    const { raised, evaluations } = evaluate([target()])
    expect(raised).toHaveLength(1)
    const [id, alert] = raised[0]
    expect(id).toBe(VESSEL)
    expect(alert?.message).toContain('Nordic Star')
    expect(alert?.data).toMatchObject({
      targetRef: `vessels.${VESSEL}`,
      source: 'ais',
      sources: ['ais', 'radar']
    })
    expect(evaluations[0].context).toBe(`vessels.${VESSEL}`)
  })

  it('points a radar-only alarm at the radar target and publishes no vessel data', () => {
    const { raised, evaluations } = evaluate([
      target({
        id: 'radar:radar-0:17',
        context: undefined,
        name: undefined,
        mmsi: undefined,
        sources: [{ type: 'radar', id: 'radar-0:17', ref: RADAR_REF }]
      })
    ])
    const [id, alert] = raised[0]
    expect(id).toBe('radar:radar-0:17')
    expect(alert?.message).toContain('radar target radar-0:17')
    expect(alert?.data).toMatchObject({ targetRef: RADAR_REF, source: 'radar' })
    expect(evaluations[0].context).toBeUndefined()
  })
})
