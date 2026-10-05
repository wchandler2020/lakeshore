# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Context

This is the Django backend of the Lakeshore monorepo (repo root is `..`). Siblings:
`../mobile/` (Expo React Native app, has its own CLAUDE.md), `../routing/` (GraphHopper
config), `../docker-compose.yml` (full stack). Django 5.1 + DRF + GeoDjango/PostGIS,
Celery on Redis, SimpleJWT auth, drf-spectacular for the OpenAPI schema. Python 3.12.

## Commands

Stack (run from repo root; GraphHopper needs `routing/data/illinois-latest.osm.pbf`,
see `../README.md`; first boot builds the graph cache, 5–15 min):

```bash
docker compose up                      # db (host port 5433), redis, graphhopper (8989), api (8000), worker
docker compose run --rm api python manage.py makemigrations
docker compose run --rm api python manage.py migrate
```

Lint and test (run from `backend/`; this is exactly what CI runs):

```bash
ruff check .
pytest -v
pytest workouts/tests/test_workouts.py::TestWorkoutIngest::test_client_cannot_spoof_distance
```

There is no pytest.ini/pyproject: **`DJANGO_SETTINGS_MODULE=config.settings.test` must be set
in the environment** (CI sets it), along with `DATABASE_URL` (a `postgis://` URL) when not
using the default `localhost:5432`. Against the compose DB from the host:
`DATABASE_URL=postgis://runclub:devpassword@localhost:5433/runclub`. Running natively on macOS
requires `brew install gdal geos proj`; otherwise run tests inside the container with
`docker compose run --rm -e DJANGO_SETTINGS_MODULE=config.settings.test api pytest`.

API schema / docs: `http://localhost:8000/api/schema/` and `/api/docs/`. The mobile app
generates its TS types from the schema (`npm run api:types` in `../mobile`), so any view
that isn't a generic/ModelSerializer-backed view needs `@extend_schema` (see
`accounts/views.py:MeView`) or it produces no client types.

## Architecture

- **Settings**: `config/settings/{base,local,test}.py`. `base` reads `../.env` (repo root)
  via django-environ. `test` uses MD5 hashing and `CELERY_TASK_ALWAYS_EAGER`. Default
  DRF permission is `IsAuthenticated`, JWT auth, page-number pagination (20).
- **URLs**: all API routes are under `api/v1/` — `auth/` (accounts), `routes/`, `workouts/`.
- **accounts**: custom `accounts.User` (`AUTH_USER_MODEL`) with unique email;
  `EmailOrUsernameModelBackend` lets the SimpleJWT `login/` endpoint accept either
  identifier (case-insensitive) in the `username` field. Domain data lives on
  `UserProfile`, auto-created by a `post_save` signal (wired in `AccountsConfig.ready`).
- **routes**: no models — routes are ephemeral. `routes/services.py` wraps self-hosted
  GraphHopper's `round_trip` algorithm. Because round-trip distance is inexact, it fires
  N seeds concurrently (ThreadPoolExecutor), dedupes by distance, and ranks by error vs.
  target; runner-ups are the "another option" choices. `RouteGenerationError` → 422,
  anything else → 503.
- **workouts**: one row per workout. GPS path is a PostGIS `LineStringField(geography=True)`;
  per-point telemetry (`t`, `hr`, `cad`, `ele`) is a JSON list positionally aligned with
  the path coords — deliberately no per-point table. Clients POST raw `points`;
  `WorkoutCreateSerializer` runs `workouts/services.py:process_track`, which filters GPS
  noise/glitches and computes distance, moving time, elevation, splits and HR server-side
  (client-supplied stats are ignored). Privacy defaults from the user's profile.
  `WorkoutViewSet` is always scoped to `request.user`; list serializers omit geometry.
- **Tests**: `<app>/tests/`; shared fixtures (`api_client`, `user`, `other_user`,
  `auth_client`) in `conftest.py` at the backend root.

## Gotchas

- **Coordinate order.** GraphHopper's `point=` param is `lat,lng`; GeoJSON, GEOS
  `LineString` and PostGIS are `(lng, lat)`. Swapping these is the known recurring bug here.
- **GraphHopper config** (`../routing/config.yml`, targets GraphHopper 10.x): `profiles_ch`
  must stay empty — round-trip is a flexible-mode algorithm and breaks with CH. Use LM.
- `routes/services.py` and `RouteRequestSerializer` both define sample-count defaults
  (20 vs. 8); the serializer's value is what the API actually uses.
