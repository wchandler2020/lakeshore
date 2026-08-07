"""
workouts/serializers.py
"""

from rest_framework import serializers

from .models import Workout
from .services import TrackPoint


class TrackPointSerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lng = serializers.FloatField(min_value=-180, max_value=180)
    timestamp = serializers.DateTimeField()
    elevation = serializers.FloatField(required=False, allow_null=True)
    heart_rate = serializers.IntegerField(
        required=False, allow_null=True, min_value=20, max_value=250
    )
    cadence = serializers.IntegerField(
        required=False, allow_null=True, min_value=0, max_value=300
    )


class WorkoutCreateSerializer(serializers.ModelSerializer):
    """
    Accepts a raw GPS track. Distance, duration, splits and elevation
    are all computed server-side — never trust client-reported totals,
    since they vary by device and can be trivially faked on a
    leaderboard.
    """

    points = TrackPointSerializer(many=True, write_only=True, required=False)

    class Meta:
        model = Workout
        fields = [
            "id",
            "activity_type",
            "source",
            "privacy",
            "title",
            "notes",
            "started_at",
            "ended_at",
            "points",
        ]
        read_only_fields = ["id"]

    def validate(self, attrs):
        if attrs["ended_at"] <= attrs["started_at"]:
            raise serializers.ValidationError(
                {"ended_at": "Must be after started_at."}
            )
        return attrs

    def create(self, validated_data):
        raw_points = validated_data.pop("points", [])
        user = self.context["request"].user

        if "privacy" not in validated_data:
            profile = getattr(user, "profile", None)
            if profile:
                validated_data["privacy"] = profile.default_run_privacy

        workout = Workout(user=user, **validated_data)

        if raw_points:
            from .services import process_track

            track = process_track([
                TrackPoint(
                    lat=p["lat"],
                    lng=p["lng"],
                    timestamp=p["timestamp"],
                    elevation=p.get("elevation"),
                    heart_rate=p.get("heart_rate"),
                    cadence=p.get("cadence"),
                )
                for p in raw_points
            ])

            workout.path = track.line
            workout.distance_m = track.distance_m
            workout.duration_s = track.duration_s
            workout.moving_time_s = track.moving_time_s
            workout.elevation_gain_m = track.elevation_gain_m
            workout.elevation_loss_m = track.elevation_loss_m
            workout.telemetry = track.telemetry
            workout.splits = track.splits
            workout.average_heart_rate = track.average_heart_rate
            workout.max_heart_rate = track.max_heart_rate

        # if "privacy" not in validated_data:
        #     profile = getattr(user, "profile", None)
        #     if profile:
        #         validated_data["privacy"] = profile.default_run_privacy

        workout.save()
        return workout


class WorkoutListSerializer(serializers.ModelSerializer):
    """Summary view. Deliberately excludes geometry and telemetry —
    a history screen shouldn't transfer megabytes of coordinates."""

    distance_mi = serializers.FloatField(read_only=True)
    pace_s_per_mi = serializers.FloatField(read_only=True)

    class Meta:
        model = Workout
        fields = [
            "id",
            "activity_type",
            "source",
            "privacy",
            "title",
            "started_at",
            "ended_at",
            "distance_m",
            "distance_mi",
            "duration_s",
            "moving_time_s",
            "pace_s_per_mi",
            "elevation_gain_m",
            "average_heart_rate",
            "max_heart_rate",
        ]


class WorkoutDetailSerializer(WorkoutListSerializer):
    """Full view, including the path geometry as GeoJSON."""

    geometry = serializers.SerializerMethodField()

    class Meta(WorkoutListSerializer.Meta):
        fields = WorkoutListSerializer.Meta.fields + [
            "notes",
            "elevation_loss_m",
            "calories",
            "splits",
            "telemetry",
            "geometry",
        ]

    def get_geometry(self, obj):
        if not obj.path:
            return None
        return {
            "type": "LineString",
            "coordinates": [list(c) for c in obj.path.coords],
        }