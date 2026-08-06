"""
routes/urls.py
"""

from django.urls import path

from .views import GenerateRouteView

urlpatterns = [
    path("generate/", GenerateRouteView.as_view(), name="route-generate"),
]