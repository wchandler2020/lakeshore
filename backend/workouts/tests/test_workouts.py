"""
workouts/tests/test_workouts.py
"""

from datetime import datetime, timedelta, timezone

import pytest
from django.urls import reverse

from workouts.models import Workout

pytestmark = pytest.mark.django_db

START = datetime(2026, 8, 6, 12, 0, 0, tzinfo=timezone.utc)


def track_payload(**overrides):
    payload = {
        "activity_type": "run",
        "title": "Test run",
        "started_at": START.isoformat(),
        "ended_at": (START + timedelta(minutes=30)).isoformat(),
        "points": [
            {
                "lat": 41.8827 + i * 0.0029,
                "lng": -87.6233,
                "timestamp": (START + timedelta(seconds=i * 120)).isoformat(),
                "heart_rate": 130 + i * 5,
            }
            for i in range(11)
        ],
    }
    payload.update(overrides)
    return payload


class TestWorkoutIngest:
    def test_creates_workout_with_computed_stats(self, auth_client, user):
        response = auth_client.post(
            reverse("workout-list"), track_payload(), format="json"
        )
        assert response.status_code == 201

        workout = Workout.objects.get(user=user)
        assert workout.distance_m > 0
        assert workout.duration_s == 1200
        assert workout.path is not None
        assert workout.average_heart_rate is not None

    def test_client_cannot_spoof_distance(self, auth_client, user):
        """
        Distance must be derived from the track, never accepted from
        the client — otherwise leaderboards are trivially gamed.
        """
        response = auth_client.post(
            reverse("workout-list"),
            track_payload(distance_m=999999),
            format="json",
        )
        assert response.status_code == 201
        workout = Workout.objects.get(user=user)
        assert workout.distance_m < 10000

    def test_privacy_defaults_from_profile(self, auth_client, user):
        user.profile.default_run_privacy = "private"
        user.profile.save()

        auth_client.post(reverse("workout-list"), track_payload(), format="json")
        assert Workout.objects.get(user=user).privacy == "private"

    def test_end_before_start_rejected(self, auth_client):
        response = auth_client.post(
            reverse("workout-list"),
            track_payload(
                started_at=(START + timedelta(hours=1)).isoformat(),
                ended_at=START.isoformat(),
            ),
            format="json",
        )
        assert response.status_code == 400

    def test_workout_without_points_is_allowed(self, auth_client, user):
        """Manual entry — no GPS track, just start and end times."""
        payload = track_payload(source="manual")
        payload.pop("points")
        response = auth_client.post(
            reverse("workout-list"), payload, format="json"
        )
        assert response.status_code == 201
        assert Workout.objects.get(user=user).path is None

    def test_requires_authentication(self, api_client):
        response = api_client.post(
            reverse("workout-list"), track_payload(), format="json"
        )
        assert response.status_code == 401


class TestWorkoutOwnership:
    """
    The important one. A GPS trace reveals where someone lives and runs.
    Leaking another user's workout is a real safety problem, not just
    a permissions bug.
    """

    def test_list_excludes_other_users_workouts(
        self, auth_client, user, other_user
    ):
        Workout.objects.create(
            user=other_user,
            started_at=START,
            ended_at=START + timedelta(minutes=30),
        )
        response = auth_client.get(reverse("workout-list"))
        assert response.status_code == 200
        assert response.data["count"] == 0

    def test_cannot_retrieve_another_users_workout(
        self, auth_client, other_user
    ):
        theirs = Workout.objects.create(
            user=other_user,
            started_at=START,
            ended_at=START + timedelta(minutes=30),
        )
        response = auth_client.get(
            reverse("workout-detail", args=[theirs.id])
        )
        assert response.status_code == 404

    def test_cannot_delete_another_users_workout(
        self, auth_client, other_user
    ):
        theirs = Workout.objects.create(
            user=other_user,
            started_at=START,
            ended_at=START + timedelta(minutes=30),
        )
        response = auth_client.delete(
            reverse("workout-detail", args=[theirs.id])
        )
        assert response.status_code == 404
        assert Workout.objects.filter(id=theirs.id).exists()


class TestWorkoutDetail:
    def test_detail_includes_geometry(self, auth_client, user):
        auth_client.post(reverse("workout-list"), track_payload(), format="json")
        workout = Workout.objects.get(user=user)

        response = auth_client.get(reverse("workout-detail", args=[workout.id]))
        assert response.status_code == 200
        assert response.data["geometry"]["type"] == "LineString"
        assert len(response.data["geometry"]["coordinates"]) > 1

    def test_list_omits_geometry(self, auth_client, user):
        """History screens must not transfer full coordinate arrays."""
        auth_client.post(reverse("workout-list"), track_payload(), format="json")
        response = auth_client.get(reverse("workout-list"))
        assert "geometry" not in response.data["results"][0]