"""
workouts/services.py

Turns a raw list of GPS samples into a persisted Workout: builds the
PostGIS LineString, computes distance, splits, and elevation change.

Distance is computed in Python rather than deferred to PostGIS. It's a
cheap haversine accumulation, it happens once at ingest, and keeping it
here means the value is available before the row is saved and doesn't
require a database round trip to read back.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime

from django.contrib.gis.geos import LineString

EARTH_RADIUS_M = 6_371_008.8
MILES_TO_METERS = 1609.344
KM_TO_METERS = 1000.0

# Samples closer together than this are treated as noise and skipped.
# Consumer GPS jitters by a few metres even when stationary; without
# this, a run that pauses at a stoplight accumulates phantom distance.
MIN_SEGMENT_M = 2.0

# Speed above which a sample is treated as a GPS glitch rather than
# real movement. 12 m/s is roughly 2:14/mile — faster than any human
# runs, so anything above it is a bad fix.
MAX_PLAUSIBLE_SPEED_MS = 12.0

# Below this speed the athlete is considered stopped, for moving-time.
MOVING_THRESHOLD_MS = 0.5


@dataclass
class TrackPoint:
    lat: float
    lng: float
    timestamp: datetime
    elevation: float | None = None
    heart_rate: int | None = None
    cadence: int | None = None


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance between two points, in metres."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = math.radians(lng2 - lng1)

    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


@dataclass
class ProcessedTrack:
    line: LineString | None
    distance_m: float
    duration_s: int
    moving_time_s: int
    elevation_gain_m: float
    elevation_loss_m: float
    telemetry: list[dict]
    splits: list[dict]
    average_heart_rate: int | None
    max_heart_rate: int | None


def process_track(
    points: list[TrackPoint], split_unit_m: float = MILES_TO_METERS
) -> ProcessedTrack:
    """
    Clean the track, build the geometry, and compute summary statistics
    in a single pass.
    """
    if len(points) < 2:
        return ProcessedTrack(
            line=None,
            distance_m=0.0,
            duration_s=0,
            moving_time_s=0,
            elevation_gain_m=0.0,
            elevation_loss_m=0.0,
            telemetry=[],
            splits=[],
            average_heart_rate=None,
            max_heart_rate=None,
        )

    points = sorted(points, key=lambda p: p.timestamp)
    start_time = points[0].timestamp

    kept: list[TrackPoint] = [points[0]]
    cumulative_m = 0.0
    moving_s = 0
    gain = 0.0
    loss = 0.0
    splits: list[dict] = []
    next_split_at = split_unit_m
    last_split_time = 0.0

    for previous, current in zip(points, points[1:]):
        segment_m = haversine_m(
            previous.lat, previous.lng, current.lat, current.lng
        )
        elapsed_s = (current.timestamp - previous.timestamp).total_seconds()

        if elapsed_s <= 0:
            continue

        # Discard implausible jumps — usually a bad GPS fix after
        # emerging from a tunnel or between buildings.
        if segment_m / elapsed_s > MAX_PLAUSIBLE_SPEED_MS:
            continue

        if segment_m < MIN_SEGMENT_M:
            continue

        kept.append(current)
        cumulative_m += segment_m

        if segment_m / elapsed_s >= MOVING_THRESHOLD_MS:
            moving_s += int(elapsed_s)

        if previous.elevation is not None and current.elevation is not None:
            delta = current.elevation - previous.elevation
            if delta > 0:
                gain += delta
            else:
                loss += abs(delta)

        # Emit a split each time we cross a unit boundary.
        while cumulative_m >= next_split_at:
            split_time = (current.timestamp - start_time).total_seconds()
            splits.append({
                "index": len(splits) + 1,
                "distance_m": round(next_split_at, 1),
                "elapsed_s": round(split_time),
                "duration_s": round(split_time - last_split_time),
            })
            last_split_time = split_time
            next_split_at += split_unit_m

    if len(kept) < 2:
        line = None
    else:
        # GEOS expects (x, y) == (lng, lat). This is the opposite of
        # how GPS APIs hand you coordinates, and getting it backwards
        # puts Chicago runs in Antarctica.
        line = LineString(
            [(p.lng, p.lat) for p in kept], srid=4326
        )

    telemetry = [
        {
            "t": round((p.timestamp - start_time).total_seconds()),
            **({"hr": p.heart_rate} if p.heart_rate is not None else {}),
            **({"cad": p.cadence} if p.cadence is not None else {}),
            **({"ele": round(p.elevation, 1)} if p.elevation is not None else {}),
        }
        for p in kept
    ]

    heart_rates = [p.heart_rate for p in kept if p.heart_rate is not None]

    return ProcessedTrack(
        line=line,
        distance_m=round(cumulative_m, 2),
        duration_s=int((points[-1].timestamp - start_time).total_seconds()),
        moving_time_s=moving_s,
        elevation_gain_m=round(gain, 1),
        elevation_loss_m=round(loss, 1),
        telemetry=telemetry,
        splits=splits,
        average_heart_rate=(
            round(sum(heart_rates) / len(heart_rates)) if heart_rates else None
        ),
        max_heart_rate=max(heart_rates) if heart_rates else None,
    )