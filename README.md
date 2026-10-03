# Signal K Collision Alerts

Warns you when another vessel is on course to pass too close. For every AIS target in range (and every radar or camera target, on servers that merge them) the plugin works out the closest point of approach (CPA) and the time until it (TCPA), and raises a Signal K alarm when both fall inside your chosen limits. Chart plotters such as Freeboard-SK show the alarm, sound it, and let you acknowledge or silence it.

## Setup

Install the plugin from the App Store, enable it, and pick an **Alert sensitivity**:

| Sensitivity       | Warn                       | Alarm                      |
| ----------------- | -------------------------- | -------------------------- |
| Harbour           | CPA ≤ 100 m within 5 min   | CPA ≤ 50 m within 2 min    |
| Coastal (default) | CPA ≤ 0.5 NM within 12 min | CPA ≤ 0.25 NM within 6 min |
| Offshore          | CPA ≤ 1 NM within 20 min   | CPA ≤ 0.5 NM within 10 min |
| Custom            | your own list of zones     |                            |

If you used the CPA calculation in **SK Derived Data**, turn it off there so you don't get every alarm twice.

## What it publishes

- `notifications.navigation.closestApproach.<target id>` on own vessel, one alarm per target, through the server's Notifications API so acknowledge and silence work from any app. The alarm's `data` carries `targetRef` (the target's Signal K context, e.g. `vessels.urn:mrn:imo:mmsi:244123456`), `source`, `cpa` (m), `tcpa` (s), `range` (m) and `cpaPositions`.
- `vessels.<target id>.navigation.closestApproach` `{distance, timeTo}` for each target in range (can be turned off).

An alarm escalates as soon as a target enters a stricter zone, and is held until the target is clearly outside it again, so a CPA hovering on a limit doesn't make the alarm flicker.

## Radar and other sensors

On a Signal K server with the Targets API, the plugin evaluates the server's merged targets instead of the AIS vessels. The server links a radar (or camera) target to the AIS vessel it is, so one ship seen by AIS and radar raises one alarm, not two, and boats with no AIS are covered too when a sensor plugin such as mayara reports them. The alarm then points at the AIS vessel when there is one, and otherwise at the sensor's own record of the target (for radar, `vessels.self.radars.<radar>.targets.<n>`); A sensor without such a record gets `targets.<target id>`, which is the target's entry in the server's Targets API (`/signalk/v2/api/targets/<target id>`). `data.sources` lists every sensor that sees it.

Sensor plugins may also raise alarms of their own. For mayara, set its radar collision alarm setting to _Leave to the Collision Alerts plugin_ so a ship seen on radar does not alarm twice.

## Development

```shell
npm install
npm run build:all   # lint + format check, build, tests
```
