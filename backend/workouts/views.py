"""
workouts/views.py
"""

from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

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

    @extend_schema(
        request=WorkoutCreateSerializer,
        responses={201: WorkoutDetailSerializer},
    )
    def create(self, request, *args, **kwargs):
        """
        Ingest a track and respond with the full detail view, so the
        client gets the server-computed totals and geometry without a
        second request.
        """
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        detail = WorkoutDetailSerializer(
            serializer.instance, context=self.get_serializer_context()
        )
        headers = self.get_success_headers(detail.data)
        return Response(detail.data, status=status.HTTP_201_CREATED, headers=headers)

    def get_queryset_for_list(self):
        # Listing never needs geometry or telemetry; defer them so the
        # database doesn't ship megabytes per row.
        return self.get_queryset().defer("path", "telemetry")

    def list(self, request, *args, **kwargs):
        self.queryset = self.get_queryset_for_list()
        return super().list(request, *args, **kwargs)