# Signal K Collision Alerts

Warns you when another vessel is on course to pass too close. For every AIS target in range the plugin works out the closest point of approach (CPA) and the time until it (TCPA), and raises a Signal K alarm when both fall inside your chosen limits. Chart plotters such as Freeboard-SK show the alarm, sound it, and let you acknowledge or silence it.

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

## Roadmap

The alarm format is meant to be shared by every collision source: radar ARPA (mayara), camera detection and others. Later versions will evaluate the fused target picture from a Signal K targets API, so one ship seen by AIS and radar raises one alarm, not two.

## Development

```shell
npm install
npm run build:all   # lint + format check, build, tests
```
