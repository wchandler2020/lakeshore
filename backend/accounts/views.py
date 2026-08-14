"""
accounts/views.py

Login itself is handled by SimpleJWT's built-in TokenObtainPairView —
wired up directly in urls.py, no custom view needed there since our
EmailOrUsernameModelBackend already makes it accept either identifier
in the "username" field.
"""
from drf_spectacular.utils import extend_schema
from rest_framework import generics, permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import UserProfile
from .serializers import RegisterSerializer, UserProfileSerializer, UserSerializer


class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]


class MeView(APIView):
    """GET/PATCH the logged-in user's own profile + basic info."""

    permission_classes = [permissions.IsAuthenticated]

    # APIView gives spectacular no serializer to introspect, so the
    # schema has to be declared explicitly. Without these, /me/ appears
    # in the docs with no documented response and generates no types.
    @extend_schema(responses=UserSerializer)
    def get(self, request):
        return Response(UserSerializer(request.user).data)

    @extend_schema(request=UserProfileSerializer, responses=UserSerializer)
    def patch(self, request):
        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        serializer = UserProfileSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(UserSerializer(request.user).data)