"""
routes/tests/test_route_generator.py

Tests for RouteGenerator's sampling, dedupe and ranking. GraphHopper is
replaced with a fake client, so these need no network and no database.
"""

from routes import services
from routes.services import GeneratedRoute, RouteGenerator


class FakeClient:
    """Returns a canned distance (or None, for a failed seed) per seed."""

    def __init__(self, distances_by_seed):
        self.distances_by_seed = distances_by_seed

    def round_trip(self, lat, lng, distance_m, seed, profile="foot"):
        distance = self.distances_by_seed[seed]
        if distance is None:
            return None
        return GeneratedRoute(
            distance_m=distance, duration_ms=0, coordinates=[], seed=seed
        )


class TestRouteGeneratorDedupe:
    def test_duplicates_keep_closest_copy_and_result_is_not_padded(
        self, monkeypatch
    ):
        monkeypatch.setattr(
            services.random, "sample", lambda population, k: [1, 2, 3, 4]
        )
        client = FakeClient({1: 5000.9, 2: 5000.2, 3: None, 4: 5300.0})

        routes = RouteGenerator(client=client).generate(
            lat=41.8827, lng=-87.6233, distance_m=5000, samples=4, return_count=3
        )

        # Seeds 1 and 2 share the fingerprint 5000; the closer one (seed 2)
        # survives, the failed seed is dropped, and nothing pads to 3.
        assert [r.seed for r in routes] == [2, 4]
        assert [r.distance_m for r in routes] == [5000.2, 5300.0]
