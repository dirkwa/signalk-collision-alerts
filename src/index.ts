import type { Context, Delta, Path, Plugin, ServerAPI } from '@signalk/server-api'
import { DeltaAlarmSink, ManagedAlarmSink, type AlarmSink } from './alarms.js'
import { Evaluator, toTrack, type Evaluation, type VesselNode } from './evaluator.js'
import { ConfigSchema, DEFAULTS, type Config } from './config.js'
import { PRESETS, type Zone } from './zones.js'

const PLUGIN_ID = 'signalk-collision-alerts'
const NM = 1852

function zonesFor(config: Config): Zone[] {
  return config.preset === 'custom' ? config.customZones : PRESETS[config.preset]
}

function createSink(app: ServerAPI): AlarmSink {
  try {
    // getId throws NotificationManagerDisabledError when the server leaves
    // notifications unmanaged; ack/silence then don't exist, so fall back.
    app.notifications.getId('probe' as Parameters<ServerAPI['notifications']['getId']>[0])
    return new ManagedAlarmSink(app)
  } catch {
    app.debug('Notification management unavailable, publishing notification deltas')
    return new DeltaAlarmSink(app, PLUGIN_ID)
  }
}

export default function (app: ServerAPI): Plugin {
  let timer: ReturnType<typeof setInterval> | undefined
  let evaluator: Evaluator | undefined
  const published = new Set<string>()

  function publishClosestApproach(evaluations: Evaluation[]): void {
    for (const { targetId, result } of evaluations) {
      if (!result && !published.has(targetId)) {
        continue
      }
      const value = result ? { distance: result.cpa, timeTo: result.tcpa } : null
      if (result) {
        published.add(targetId)
      } else {
        published.delete(targetId)
      }
      const delta: Delta = {
        context: `vessels.${targetId}` as Context,
        updates: [{ values: [{ path: 'navigation.closestApproach' as Path, value }] }]
      }
      app.handleMessage(PLUGIN_ID, delta)
    }
  }

  return {
    id: PLUGIN_ID,
    name: 'Collision Alerts',
    description: 'CPA/TCPA collision alerts for AIS targets',
    schema: () => ConfigSchema,

    start(partial: object) {
      // The server does not apply schema defaults at runtime.
      const config: Config = { ...DEFAULTS, ...(partial as Partial<Config>) }
      const maxAge = config.maxAge
      const activeEvaluator = new Evaluator(
        { zones: zonesFor(config), maxRange: config.maxRange * NM, maxAge },
        createSink(app)
      )
      evaluator = activeEvaluator

      timer = setInterval(() => {
        // One bad target or data-model surprise must not stop the alarm loop.
        try {
          const now = Date.now()
          const own = toTrack(
            { navigation: app.getSelfPath('navigation') as VesselNode['navigation'] },
            now,
            maxAge
          )
          const vessels = (app.getPath('vessels') ?? {}) as Record<string, VesselNode>
          const evaluations = activeEvaluator.evaluate(own, vessels, app.selfId, now)
          if (config.publishClosestApproach) {
            publishClosestApproach(evaluations)
          }
        } catch (err) {
          app.error(`Collision evaluation failed: ${String(err)}`)
        }
      }, config.interval * 1000)
      app.setPluginStatus('Watching AIS targets')
    },

    stop() {
      clearInterval(timer)
      timer = undefined
      evaluator?.stop()
      evaluator = undefined
      publishClosestApproach([...published].map((targetId) => ({ targetId, result: null })))
    }
  }
}
