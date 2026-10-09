# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Lakeshore: a running app with route planning, workout tracking, and (planned) training plans and social features. It's a monorepo:

- `backend/`: Django 5.1 + DRF + GeoDjango (PostGIS), Celery on Redis, JWT auth (SimpleJWT)
- `mobile/`: React Native via Expo SDK 57 (prebuild/bare), Expo Router, NativeWind, `@rnmapbox/maps`
- `routing/`: config for a self-hosted GraphHopper 10.x that runs on an Illinois OSM extract
- `infra/` and `docs/` are empty placeholders for now.

`mobile/CLAUDE.md` (which pulls in `mobile/AGENTS.md`) says Expo has changed: read the versioned docs at https://docs.expo.dev/versions/v57.0.0/ before you write mobile code.

## Commands

### Full stack (Docker)
```bash
# One-time step: download the OSM extract (~450 MB) to routing/data/illinois-latest.osm.pbf (see README)
docker compose up           # db (host port 5433), redis, graphhopper (8989), api (8000), worker
```
The first GraphHopper boot builds the graph cache and takes 5–15 minutes. The cache persists in the `ghcache` volume.

### Backend (run from `backend/`)
```bash
docker compose run --rm api pytest
docker compose run --rm api ruff check .          # CI runs this
docker compose run --rm api python manage.py makemigrations
docker compose run --rm api python manage.py migrate

ruff check .                                    # lint (CI runs this)
# DJANGO_SETTINGS_MODULE=config.settings.test pytest -v
# DJANGO_SETTINGS_MODULE=config.settings.test pytest workouts/tests/test_process_track.py::test_name
python manage.py makemigrations && python manage.py migrate
```
- There's no pytest.ini or pyproject, so you have to set `DJANGO_SETTINGS_MODULE` yourself (CI sets it as an env var).
- Tests need a live PostGIS database. Docker publishes Postgres on host port **5433**, but the default `DATABASE_URL` in `config/settings/base.py` points at 5432, so set `DATABASE_URL=postgis://runclub:devpassword@localhost:5433/runclub` when you run outside Docker. Another option is `docker compose exec api pytest`.
- On the host, GeoDjango needs GDAL/GEOS/PROJ (`brew install gdal geos proj`). A local venv lives at `backend/.venv`.
- Settings modules are `config.settings.local` (dev, CORS wide open), `config.settings.test` (MD5 hasher, Celery eager), and `base`. `base.py` reads `.env` from the **repo root**, not from `backend/`.

### Mobile (run from `mobile/`)
```bash
npm install                 # postinstall runs patch-package (patches/expo-modules-jsi)
npx expo run:ios            # or run:android; native build required (Mapbox), Expo Go won't work
npx expo start              # Metro only, once a dev build is installed
npm run api:types           # regenerate lib/api/schema.d.ts from the running backend's OpenAPI schema
npx tsc --noEmit            # type-check (no lint/test scripts are configured)
```
Env vars go in `mobile/.env`: `EXPO_PUBLIC_MAPBOX_TOKEN` (required, or maps render blank) and `EXPO_PUBLIC_API_URL` (optional; by default the client uses the dev machine's LAN host on port 8000).

## Architecture

### API contract flows backend → mobile
drf-spectacular serves the OpenAPI schema at `/api/schema/` (Swagger UI at `/api/docs/`). The mobile client is typed from that schema:
`schema.d.ts` (generated, never hand-edit) → `lib/api/types.ts` (friendly aliases; screens import types from here) → `lib/api/endpoints.ts` (one typed wrapper per endpoint; screens call these, never axios directly) → `lib/api/client.ts` (axios instance).
When you change a serializer, run `npm run api:types` and update `types.ts` if schema names changed.

All endpoints are versioned under `/api/v1/` (`auth/`, `routes/`, `workouts/`). The DRF defaults are JWT auth, `IsAuthenticated`, and page-number pagination with 20 per page.

### Auth
- The custom `accounts.User` model plus the `EmailOrUsernameModelBackend` let login accept either a username or an email. The mobile app sends either one as `username`.
- SimpleJWT rotates refresh tokens (`ROTATE_REFRESH_TOKENS=True`), so every refresh returns a new refresh token and the old one stops working. `client.ts` collapses concurrent 401s into a single in-flight refresh and uses a bare `axios` call for the refresh request to avoid interceptor recursion. Keep both behaviors.
- Tokens live in `expo-secure-store`. `lib/auth-context.tsx` holds session state. `app/_layout.tsx` redirects between the `(auth)` and `(tabs)` route groups based on `user`/`loading`.
- `UserProfile` is auto-created by a `post_save` signal wired in `AccountsConfig.ready`.
  The `signals` import there looks unused and is not — removing it silently breaks signup.

### Route generation (`backend/routes/`)
Routes are ephemeral: they're generated on demand and never persisted. `RouteGenerator` in `services.py` fires many GraphHopper `round_trip` requests with random seeds in parallel through a `ThreadPoolExecutor`. GraphHopper only approximates the target distance, so the generator ranks results by distance error, dedupes them by rounded distance, and returns the top N. The runner-up routes act as "other options". A failure on one seed returns `None` and doesn't fail the whole batch. If every seed fails, the view returns 422 with `RouteGenerationError`. Other exceptions return 503.

**Coordinate order is the classic bug here.** GraphHopper's `point=` param takes `lat,lng`, but its returned coordinates are GeoJSON `[lng, lat]`. PostGIS and Mapbox also use `lng, lat`.

**GraphHopper config (`routing/config.yml`):** round-trip is a flexible-mode algorithm, so `profiles_ch` must stay empty because CH breaks round-trip. LM profiles provide the speedup.

### Workouts (`backend/workouts/`)
The client uploads raw GPS `points` with the workout. `services.process_track` computes distance, splits, moving time, elevation, and HR stats on the server in one pass. It filters out GPS jitter below 2 m and glitches above 12 m/s, and computes distance with haversine in Python, not PostGIS. Totals the client sends are ignored. Storage is a PostGIS `LineStringField` for the path plus JSONB `telemetry` and `splits`.

### Async
Celery (`config/celery.py`, app name `lakeshore`) runs on Redis with `autodiscover_tasks()`. Tests run tasks eagerly.

### Mobile styling
NativeWind v4 (Tailwind 3) is wired through `metro.config.js` → `global.css`. Fonts load in the root layout and are aliased to the names `tailwind.config.js` expects (`ArchivoExpanded_*`, `Inter_*`). The `@/*` path alias maps to `mobile/`.

## Gotchas
- Any view that isn't backed by a generic + ModelSerializer needs `@extend_schema`
  (see `accounts/views.py:MeView`) or it generates no client types.
- `WorkoutViewSet` is always scoped to `request.user`. A GPS trace shows where someone
  lives — the ownership tests are a privacy guarantee, not boilerplate.
- Regenerating `mobile/patches/expo-modules-jsi`: delete `apple/Products` and
  `apple/.generated` from the package first, or the patch captures compiled build
  output (it was once 62,907 lines instead of 15). Afterwards you must
  `rm -rf ios/Pods ios/build ~/Library/Developer/Xcode/DerivedData/mobile-*`,
  reinstall pods and rebuild, or the app dies at launch with a dyld error.
- NativeWind is pinned to v4 with Tailwind v3. v4 does not support Tailwind v4.
- `AUTH_USER_MODEL` is locked; changing it requires dropping the database.


