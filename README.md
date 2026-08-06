# Phase 0 — Foundations

Infrastructure only. No models, no auth, no endpoints. The single goal is
proving the routing engine returns a valid Chicago loop before any
application code exists.

## Repo layout

```
backend/     Django + DRF + GeoDjango
mobile/      React Native (Expo, bare/prebuild)
routing/     GraphHopper config + OSM data
infra/       Terraform / AWS (Phase 6)
docs/        Architecture decision records
```

## Setup

**1. Download the OSM extract** (~450 MB, from Geofabrik):

```bash
mkdir -p routing/data
curl -L -o routing/data/illinois-latest.osm.pbf \
  https://download.geofabrik.de/north-america/us/illinois-latest.osm.pbf
```

**2. Create your `.env`** from `.env.example`.

**3. Bring the stack up:**

```bash
docker compose up
```

First boot builds the GraphHopper graph cache from the Illinois extract.
Expect 5–15 minutes and a pegged CPU core. It persists in a named volume,
so this only happens once. Wait for the healthcheck to go green.

## ✅ Phase 0 checkpoint

From a clean clone, `docker compose up`, then:

```bash
curl "http://localhost:8989/route?point=41.8827,-87.6233&profile=foot\
&algorithm=round_trip&round_trip.distance=8047&round_trip.seed=42\
&instructions=true&points_encoded=false"
```

That's Millennium Park, an 8047 m (5 mile) loop on foot.

**Passing looks like:** JSON with `paths[0].distance` within roughly 10%
of 8047, `paths[0].points.coordinates` starting and ending near your
input point, and a populated `paths[0].instructions` array.

**Change the seed, get a different route.** That's your "give me another
option" button, for free.

When that responds correctly, Phase 0 is done. Everything after it is
ordinary Django.

## Known things to verify

- **GraphHopper config format changes between major versions.** This
  config targets 10.x. If the container fails to start, check the error
  against the version's docs before assuming the profiles block is wrong.
- **Round-trip requires flexible mode.** `profiles_ch` is intentionally
  empty. Adding CH profiles will break round-trip routing.
- **Round-trip distance is approximate.** The algorithm targets your
  distance but won't hit it exactly — it's finding a closed walk on a real
  road network. Surface it as "about 5 miles" in the UI, and consider
  querying a few seeds server-side and returning the closest match.
