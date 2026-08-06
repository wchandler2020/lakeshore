"""
workouts/models.py

Storage strategy: one row per workout. The GPS path lives in a PostGIS
LineString; per-point telemetry (heart rate, cadence, elevation) lives
in a JSONB column indexed positionally against the path coordinates.

The alternative — a TrackPoint table with one row per GPS sample —
means 3,600 rows for a single hour-long run at 1Hz. At a few thousand
users that table is in the hundreds of millions of rows and every
query against it is painful. The LineString + JSONB approach keeps
workout queries fast and still supports spatial operations natively.
"""

from django.conf import settings
from django.contrib.gis.db import models as gis_models
from django.db import models


class Workout(models.Model):
    class ActivityType(models.TextChoices):
        RUN = "run", "Run"
        WALK = "walk", "Walk"
        HIKE = "hike", "Hike"
        RIDE = "ride", "Ride"

    class Source(models.TextChoices):
        PHONE = "phone", "Phone GPS"
        WATCH = "watch", "Watch"
        MANUAL = "manual", "Manual entry"
        IMPORT = "import", "Imported file"

    class Privacy(models.TextChoices):
        PUBLIC = "public", "Public"
        FOLLOWERS = "followers", "Followers only"
        PRIVATE = "private", "Private"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="workouts",
    )

    activity_type = models.CharField(
        max_length=10, choices=ActivityType.choices, default=ActivityType.RUN
    )
    source = models.CharField(
        max_length=10, choices=Source.choices, default=Source.PHONE
    )
    privacy = models.CharField(
        max_length=10, choices=Privacy.choices, default=Privacy.FOLLOWERS
    )

    title = models.CharField(max_length=200, blank=True)
    notes = models.TextField(blank=True)

    started_at = models.DateTimeField()
    ended_at = models.DateTimeField()

    # geography=True makes PostGIS treat coordinates as points on a
    # sphere, so ST_Length and ST_DWithin return metres rather than
    # degrees. Worth the small performance cost — degree-based distance
    # is meaningless at Chicago's latitude.
    path = gis_models.LineStringField(
        srid=4326, geography=True, null=True, blank=True
    )

    # Denormalised so listing workouts never touches the geometry.
    distance_m = models.FloatField(default=0.0)
    duration_s = models.PositiveIntegerField(default=0)
    moving_time_s = models.PositiveIntegerField(default=0)
    elevation_gain_m = models.FloatField(default=0.0)
    elevation_loss_m = models.FloatField(default=0.0)

    average_heart_rate = models.PositiveSmallIntegerField(null=True, blank=True)
    max_heart_rate = models.PositiveSmallIntegerField(null=True, blank=True)
    calories = models.PositiveIntegerField(null=True, blank=True)

    # Positionally aligned with path.coords. Each entry may contain
    # t (seconds from start), hr, cad, ele. Sparse by design — not
    # every device reports every field.
    telemetry = models.JSONField(default=list, blank=True)

    # Per-unit splits, computed at ingest. Stored rather than derived
    # because recomputing means loading the full geometry.
    splits = models.JSONField(default=list, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-started_at"]
        indexes = [
            models.Index(fields=["user", "-started_at"]),
            models.Index(fields=["activity_type"]),
        ]

    def __str__(self):
        return f"{self.get_activity_type_display()} {self.distance_mi:.2f}mi"

    @property
    def distance_mi(self) -> float:
        return round(self.distance_m / 1609.344, 2)

    @property
    def pace_s_per_mi(self) -> float | None:
        """Average pace in seconds per mile. None for zero-distance."""
        if self.distance_mi <= 0:
            return None
        return (self.moving_time_s or self.duration_s) / self.distance_mi

    
