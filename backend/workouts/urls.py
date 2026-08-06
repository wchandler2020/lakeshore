"""
workouts/urls.py
"""

from rest_framework.routers import DefaultRouter

from .views import WorkoutViewSet

router = DefaultRouter()
router.register("", WorkoutViewSet, basename="workout")

urlpatterns = router.urls