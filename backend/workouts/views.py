"""
workouts/views.py
"""

from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated

from .models import Workout
from .serializers import (
    WorkoutCreateSerializer,
    WorkoutDetailSerializer,
    WorkoutListSerializer,
)


class WorkoutViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """
    Workout history and GPS ingest.

    Scoped to the requesting user for now. When the social graph lands,
    this widens to include followed athletes' public workouts — but the
    default stays restrictive rather than permissive.
    """

    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Workout.objects.filter(user=self.request.user)

    def get_serializer_class(self):
        if self.action == "create":
            return WorkoutCreateSerializer
        if self.action in ("retrieve", "update", "partial_update"):
            return WorkoutDetailSerializer
        return WorkoutListSerializer

    def get_queryset_for_list(self):
        # Listing never needs geometry or telemetry; defer them so the
        # database doesn't ship megabytes per row.
        return self.get_queryset().defer("path", "telemetry")

    def list(self, request, *args, **kwargs):
        self.queryset = self.get_queryset_for_list()
        return super().list(request, *args, **kwargs)