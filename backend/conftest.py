"""
backend/conftest.py

Shared fixtures. Lives at the backend root so every test module picks
it up without imports.
"""

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

User = get_user_model()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(
        username="runner",
        email="runner@example.com",
        password="TestPass123!",
    )


@pytest.fixture
def other_user(db):
    return User.objects.create_user(
        username="stranger",
        email="stranger@example.com",
        password="TestPass123!",
    )


@pytest.fixture
def auth_client(api_client, user):
    """APIClient authenticated as `user`."""
    api_client.force_authenticate(user=user)
    return api_client