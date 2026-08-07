"""
workouts/tests/test_process_track.py

Pure-function tests for GPS track processing. No database, no HTTP —
these should run in milliseconds and cover the edge cases that produce
wrong distances in production.
"""

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