"""
workouts/tests/test_process_track.py

Pure-function tests for GPS track processing. No database, no HTTP —
these should run in milliseconds and cover the edge cases that produce
wrong distances in production.
"""

import math
import random
from datetime import datetime, timedelta, timezone

import pytest

from workouts.services import TrackPoint, haversine_m, process_track

START = datetime(2026, 8, 6, 12, 0, 0, tzinfo=timezone.utc)


def point(lat, lng, seconds, **kwargs):
    return TrackPoint(
        lat=lat, lng=lng, timestamp=START + timedelta(seconds=seconds), **kwargs
    )


class TestHaversine:
    def test_zero_distance_for_identical_points(self):
        assert haversine_m(41.8827, -87.6233, 41.8827, -87.6233) == 0

    def test_known_distance(self):
        # Chicago to Milwaukee, roughly 132 km.
        distance = haversine_m(41.8781, -87.6298, 43.0389, -87.9065)
        assert 130_000 < distance < 135_000

    def test_symmetric(self):
        a = haversine_m(41.88, -87.62, 41.89, -87.63)
        b = haversine_m(41.89, -87.63, 41.88, -87.62)
        assert a == pytest.approx(b)


class TestProcessTrackEdgeCases:
    def test_empty_track(self):
        result = process_track([])
        assert result.line is None
        assert result.distance_m == 0
        assert result.splits == []

    def test_single_point(self):
        result = process_track([point(41.88, -87.62, 0)])
        assert result.line is None
        assert result.distance_m == 0

    def test_two_identical_points_produce_no_distance(self):
        """Standing still should not accumulate distance."""
        result = process_track([
            point(41.88, -87.62, 0),
            point(41.88, -87.62, 60),
        ])
        assert result.distance_m == 0

    def test_out_of_order_points_are_sorted(self):
        result = process_track([
            point(41.8900, -87.62, 300),
            point(41.8800, -87.62, 0),
        ])
        assert result.duration_s == 300
        assert result.distance_m > 0


class TestNoiseFiltering:
    def test_gps_jitter_is_discarded(self):
        """
        Sub-2m wobble while stationary must not accumulate. Without
        filtering, a runner waiting at a light gains phantom distance.
        """
        points = [point(41.8827, -87.6233, 0)]
        for i in range(1, 30):
            # ~1m of jitter, well under MIN_SEGMENT_M
            points.append(point(41.8827 + (i % 2) * 0.00001, -87.6233, i * 2))

        result = process_track(points)
        assert result.distance_m == 0

    def test_implausible_jump_is_discarded(self):
        """A bad GPS fix teleporting several km must be dropped."""
        result = process_track([
            point(41.8827, -87.6233, 0),
            point(41.8837, -87.6233, 30),   # ~110m, plausible
            point(42.5000, -87.6233, 35),   # ~68km in 5s, glitch
            point(41.8847, -87.6233, 60),   # back on track
        ])
        # Only the plausible segments should count.
        assert result.distance_m < 500

    def test_stationary_time_excluded_from_moving_time(self):
        """Pausing should reduce moving time but not total duration."""
        result = process_track([
            point(41.8827, -87.6233, 0),
            point(41.8907, -87.6233, 300),    # moving
            point(41.8907, -87.6233, 900),    # stopped 10 min
            point(41.8987, -87.6233, 1200),   # moving again
        ])
        assert result.duration_s == 1200
        assert result.moving_time_s < result.duration_s


class TestComputedStats:
    def test_elevation_gain_and_loss_tracked_separately(self):
        result = process_track([
            point(41.8827, -87.6233, 0, elevation=180.0),
            point(41.8907, -87.6233, 300, elevation=200.0),
            point(41.8987, -87.6233, 600, elevation=190.0),
        ])
        assert result.elevation_gain_m == pytest.approx(20.0)
        assert result.elevation_loss_m == pytest.approx(10.0)

    def test_heart_rate_average_and_max(self):
        result = process_track([
            point(41.8827, -87.6233, 0, heart_rate=120),
            point(41.8907, -87.6233, 300, heart_rate=150),
            point(41.8987, -87.6233, 600, heart_rate=180),
        ])
        assert result.average_heart_rate == 150
        assert result.max_heart_rate == 180

    def test_missing_heart_rate_yields_none(self):
        result = process_track([
            point(41.8827, -87.6233, 0),
            point(41.8907, -87.6233, 300),
        ])
        assert result.average_heart_rate is None
        assert result.max_heart_rate is None

    def test_splits_emitted_per_mile(self):
        """A straight ~3 mile run should produce 3 splits."""
        points = []
        for i in range(31):
            # ~0.1 mile per step, heading north
            points.append(point(41.8827 + i * 0.00145, -87.6233, i * 60))

        result = process_track(points)
        assert len(result.splits) == 3
        assert result.splits[0]["index"] == 1
        assert all(s["duration_s"] > 0 for s in result.splits)

    def test_linestring_uses_lng_lat_order(self):
        """
        GEOS expects (x, y) == (lng, lat). Reversing this is the
        classic bug — it puts Chicago runs in Antarctica.
        """
        result = process_track([
            point(41.8827, -87.6233, 0),
            point(41.8907, -87.6233, 300),
        ])
        first = result.line.coords[0]
        assert first[0] == pytest.approx(-87.6233)  # lng
        assert first[1] == pytest.approx(41.8827)   # lat

# Degrees per meter at Chicago's latitude, for building tracks in meters.
ORIGIN_LAT, ORIGIN_LNG = 41.8827, -87.6233
LAT_DEG_PER_M = 1 / 111_195
LNG_DEG_PER_M = LAT_DEG_PER_M / math.cos(math.radians(ORIGIN_LAT))


def offset_point(north_m, east_m, seconds):
    return point(
        ORIGIN_LAT + north_m * LAT_DEG_PER_M,
        ORIGIN_LNG + east_m * LNG_DEG_PER_M,
        seconds,
    )


def walk_track():
    """10 minutes north at 1.3 m/s, one fix per second."""
    return [offset_point(i * 1.3, 0, i) for i in range(600)]


def drift_track(seed=42, step_sigma_m=0.4, max_radius_m=2.0):
    """
    5 minutes standing still, one fix per second. Real GPS error drifts
    rather than jumping independently each second, so each fix is a small
    random step from the previous one, pulled back onto the boundary if
    it wanders more than max_radius_m from the true position.
    """
    rng = random.Random(seed)
    north = east = 0.0
    points = []
    for i in range(300):
        points.append(offset_point(north, east, i))
        north += rng.gauss(0, step_sigma_m)
        east += rng.gauss(0, step_sigma_m)
        r = math.hypot(north, east)
        if r > max_radius_m:
            north *= max_radius_m / r
            east *= max_radius_m / r
    return points


def scatter_track(seed=42, spread_m=1.5):
    """
    5 minutes standing still, one fix per second, each fix independently
    scattered within ±spread_m on each axis. Consecutive fixes can land
    over 4 m apart, which is what catches a too-small threshold.
    """
    rng = random.Random(seed)
    return [
        offset_point(
            rng.uniform(-spread_m, spread_m), rng.uniform(-spread_m, spread_m), i
        )
        for i in range(300)
    ]


def walk_stop_walk_track():
    """Walk 60 s at 1.3 m/s, stand still 60 s, walk 60 s. One fix per second."""
    points = []
    north_m = 0.0
    for i in range(181):
        if i > 0 and not 60 < i <= 120:
            north_m += 1.3
        points.append(offset_point(north_m, 0, i))
    return points


CURVE_RADIUS_M = 200
CURVE_ARC_M = CURVE_RADIUS_M * math.pi / 2


def curve_track():
    """A quarter circle of 200 m radius at 3 m/s, one fix per second."""
    step_rad = 3 / CURVE_RADIUS_M
    points = []
    for i in range(math.ceil(CURVE_ARC_M / 3) + 1):
        theta = min(i * step_rad, math.pi / 2)
        points.append(offset_point(
            CURVE_RADIUS_M * math.sin(theta),
            CURVE_RADIUS_M * (1 - math.cos(theta)),
            i,
        ))
    return points


class TestRealisticSampling:
    """Tracks shaped like what the app actually uploads: one fix per second."""

    def test_slow_walk_at_1hz_accumulates_distance(self):
        """
        1.3 m/s sampled every second gives 1.3 m segments — each one under
        MIN_SEGMENT_M. Jitter filtering must not throw away steady movement.
        """
        result = process_track(walk_track())
        assert result.distance_m == pytest.approx(780, rel=0.10)

    def test_stationary_drift_at_1hz_stays_near_zero(self):
        """Five minutes standing still while the GPS fix wanders ~2 m."""
        result = process_track(drift_track())
        assert result.distance_m < 20

    def test_stationary_scatter_at_1hz_stays_near_zero(self):
        """
        Five minutes standing still with independent ±1.5 m scatter per
        fix. Unlike drift, consecutive fixes can jump several metres.
        """
        result = process_track(scatter_track())
        assert result.distance_m < 20

    def test_stop_at_1hz_excluded_from_moving_time(self):
        """
        A minute stopped mid-walk must not count as moving, even though
        the segment that ends the stop spans it.
        """
        result = process_track(walk_stop_walk_track())
        assert result.duration_s == 180
        assert result.moving_time_s == pytest.approx(120, abs=12)

    def test_bad_first_fix_is_dropped(self):
        """
        A cold GPS's first fix can be hundreds of metres off. Anchoring on
        it rejects the real track as glitches and counts the offset as
        distance.
        """
        points = [offset_point(i * 3, 0, i) for i in range(601)]  # 1800 m
        points[0] = offset_point(-500, 0, 0)

        result = process_track(points)
        assert result.distance_m == pytest.approx(1800, rel=0.05)
        assert result.duration_s == 600

    def test_curved_course_at_1hz_matches_arc_length(self):
        """
        Any smoothing or thresholding that cuts corners shows up here as
        lost distance.
        """
        result = process_track(curve_track())
        assert result.distance_m == pytest.approx(CURVE_ARC_M, rel=0.03)
