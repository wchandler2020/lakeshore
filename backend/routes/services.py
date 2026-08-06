"""
routes/services.py

Wraps GraphHopper's round-trip routing.

The core problem: GraphHopper's round_trip algorithm targets a distance
but doesn't hit it exactly — it's finding a closed walk on a real road
network, so it lands where the roads allow. In testing, a 5-mile request
in downtown Chicago came back at 4.26 miles (15% short).

The fix is sampling. Each seed produces a different loop, so we fire
several concurrent requests and rank the results by distance error. The
runner-up routes become "show me another option" at no extra cost.
"""

from __future__ import annotations

import logging
import random
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

# How many seeds to try per request. Higher is more accurate but slower
# and heavier on GraphHopper. 8 was a reasonable balance in testing.
DEFAULT_SAMPLE_COUNT = 20

# Per-request timeout against GraphHopper, in seconds.
REQUEST_TIMEOUT = 10




class RouteGenerationError(Exception):
    """Raised when route generation fails for a reason worth surfacing."""


@dataclass
class GeneratedRoute:
    """A single candidate loop."""

    distance_m: float
    duration_ms: int
    coordinates: list[list[float]]  # GeoJSON order: [lng, lat]
    instructions: list[dict] = field(default_factory=list)
    seed: int = 0
    ascend_m: float = 0.0
    descend_m: float = 0.0

    @property
    def distance_mi(self) -> float:
        return self.distance_m / 1609.344

    def error_from(self, target_m: float) -> float:
        """Absolute distance error against the requested target."""
        return abs(self.distance_m - target_m)

    def to_dict(self, target_m: float) -> dict:
        return {
            "distance_m": round(self.distance_m, 1),
            "distance_mi": round(self.distance_mi, 2),
            "duration_s": round(self.duration_ms / 1000),
            "error_m": round(self.error_from(target_m), 1),
            "error_pct": round(
                (self.error_from(target_m) / target_m) * 100, 1
            ) if target_m else 0.0,
            "ascend_m": round(self.ascend_m, 1),
            "descend_m": round(self.descend_m, 1),
            "seed": self.seed,
            "geometry": {
                "type": "LineString",
                "coordinates": self.coordinates,
            },
            "instructions": [
                {
                    "text": step.get("text", ""),
                    "distance_m": round(step.get("distance", 0), 1),
                    "sign": step.get("sign", 0),
                    "street_name": step.get("street_name", ""),
                    "interval": step.get("interval", []),
                }
                for step in self.instructions
            ],
        }


class GraphHopperClient:
    """Thin HTTP client for the self-hosted GraphHopper instance."""

    def __init__(self, base_url: str | None = None):
        self.base_url = (base_url or settings.GRAPHHOPPER_URL).rstrip("/")

    def round_trip(
        self,
        lat: float,
        lng: float,
        distance_m: float,
        seed: int,
        profile: str = "foot",
    ) -> GeneratedRoute | None:
        """
        Request a single closed loop. Returns None on a per-seed failure
        so one bad sample doesn't sink the whole batch.
        """
        params = {
            # GraphHopper takes lat,lng here — note this is the OPPOSITE
            # order from the coordinates it returns, which are GeoJSON
            # [lng, lat]. Mixing these up is the classic bug in this
            # codebase; PostGIS also expects lng,lat.
            "point": f"{lat},{lng}",
            "profile": profile,
            "algorithm": "round_trip",
            "round_trip.distance": int(distance_m),
            "round_trip.seed": seed,
            "instructions": "true",
            "points_encoded": "false",
            "elevation": "false",
        }

        try:
            response = requests.get(
                f"{self.base_url}/route",
                params=params,
                timeout=REQUEST_TIMEOUT,
            )
        except requests.RequestException as exc:
            logger.warning("GraphHopper request failed (seed=%s): %s", seed, exc)
            return None

        if response.status_code != 200:
            logger.warning(
                "GraphHopper returned %s (seed=%s): %s",
                response.status_code,
                seed,
                response.text[:200],
            )
            return None

        payload = response.json()
        paths = payload.get("paths") or []
        if not paths:
            return None

        path = paths[0]
        return GeneratedRoute(
            distance_m=path.get("distance", 0.0),
            duration_ms=path.get("time", 0),
            coordinates=path.get("points", {}).get("coordinates", []),
            instructions=path.get("instructions", []),
            seed=seed,
            ascend_m=path.get("ascend", 0.0) or 0.0,
            descend_m=path.get("descend", 0.0) or 0.0,
        )

    def health(self) -> bool:
        try:
            response = requests.get(f"{self.base_url}/health", timeout=3)
            return response.status_code == 200
        except requests.RequestException:
            return False


class RouteGenerator:
    """
    Generates candidate loops by sampling multiple seeds concurrently,
    then ranks them by how close they land to the requested distance.
    """

    def __init__(self, client: GraphHopperClient | None = None):
        self.client = client or GraphHopperClient()

    def generate(
        self,
        lat: float,
        lng: float,
        distance_m: float,
        profile: str = "foot",
        samples: int = DEFAULT_SAMPLE_COUNT,
        return_count: int = 3,
    ) -> list[GeneratedRoute]:
        seeds = random.sample(range(1, 100_000), samples)

        # Blocking HTTP, so threads are the right tool. GraphHopper
        # handles concurrent requests fine; this is the difference
        # between ~8s serial and ~1s parallel.
        with ThreadPoolExecutor(max_workers=samples) as pool:
            futures = [
                pool.submit(
                    self.client.round_trip, lat, lng, distance_m, seed, profile
                )
                for seed in seeds
            ]
            candidates = [f.result() for f in futures]

        routes = [r for r in candidates if r is not None]

        if not routes:
            raise RouteGenerationError(
                "No routes could be generated from this location. It may be "
                "outside the mapped area, or too far from a road or path."
            )

        # Deduplicate: different seeds sometimes converge on the same
        # loop. Distance to the metre is a good enough fingerprint.
        seen: set[int] = set()
        unique: list[GeneratedRoute] = []
        for route in sorted(routes, key=lambda r: r.error_from(distance_m)):
            fingerprint = int(route.distance_m)
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            unique.append(route)

        return unique[:return_count]