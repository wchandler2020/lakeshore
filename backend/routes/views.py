"""
routes/views.py
"""

import logging

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import RouteRequestSerializer
from .services import RouteGenerationError, RouteGenerator

logger = logging.getLogger(__name__)


class GenerateRouteView(APIView):
    """
    POST a start point and target distance, get back ranked loop options.

    Routes are ephemeral — generated on demand, not persisted. Saving
    favourites comes later, once route quality is tuned.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = RouteRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        generator = RouteGenerator()

        try:
            routes = generator.generate(
                lat=data["lat"],
                lng=data["lng"],
                distance_m=data["distance_m"],
                profile=data["profile"],
                samples=data["samples"],
                return_count=data["count"],
            )
        except RouteGenerationError as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        except Exception:
            logger.exception("Unexpected failure generating routes")
            return Response(
                {"detail": "Route generation is temporarily unavailable."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        target = data["distance_m"]
        return Response({
            "requested_distance_m": round(target, 1),
            "count": len(routes),
            "routes": [r.to_dict(target) for r in routes],
        })