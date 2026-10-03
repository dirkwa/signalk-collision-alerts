import type { Context, Delta, Path, Plugin, ServerAPI } from '@signalk/server-api'
import { DeltaAlarmSink, ManagedAlarmSink, type AlarmSink } from './alarms.js'
import { Evaluator, toTrack, type Evaluation, type VesselNode } from './evaluator.js'
import { ConfigSchema, DEFAULTS, type Config } from './config.js'
import { PRESETS, type Zone } from './zones.js'
import { targetNodes, type TargetsHost } from './targets.js'

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
  // Contexts we published a closest approach on, so stop() can clear them.
  const published = new Set<string>()

  function publishClosestApproach(evaluations: Evaluation[]): void {
    for (const { context, result } of evaluations) {
      // Targets seen only by radar or camera have no vessel to publish on.
      if (!context || (!result && !published.has(context))) {
        continue
      }
      const value = result ? { distance: result.cpa, timeTo: result.tcpa } : null
      if (result) {
        published.add(context)
      } else {
        published.delete(context)
      }
      const delta: Delta = {
        context: context as Context,
        updates: [{ values: [{ path: 'navigation.closestApproach' as Path, value }] }]
      }
      app.handleMessage(PLUGIN_ID, delta)
    }
  }

  return {
    id: PLUGIN_ID,
    name: 'Collision Alerts',
    description: 'CPA/TCPA collision alerts for AIS, radar and other targets',
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
          // The server's merged targets, when it has them, so a boat seen on
          // both AIS and radar raises one alarm rather than one per sensor.
          const getTargets = (app as TargetsHost).getTargets
          const vessels = getTargets
            ? targetNodes(getTargets())
            : ((app.getPath('vessels') ?? {}) as Record<string, VesselNode>)
          const evaluations = activeEvaluator.evaluate(own, vessels, app.selfId, now)
          if (config.publishClosestApproach) {
            publishClosestApproach(evaluations)
          }
        } catch (err) {
          app.error(`Collision evaluation failed: ${String(err)}`)
        }
      }, config.interval * 1000)
      app.setPluginStatus(
        (app as TargetsHost).getTargets
          ? 'Watching targets from AIS and other sensors'
          : 'Watching AIS targets'
      )
    },

    stop() {
      clearInterval(timer)
      timer = undefined
      evaluator?.stop()
      evaluator = undefined
      publishClosestApproach(
        [...published].map((context) => ({ targetId: context, context, result: null }))
      )
    }
  }
}
