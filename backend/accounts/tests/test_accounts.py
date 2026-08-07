"""
accounts/tests/test_accounts.py
"""

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse

User = get_user_model()

pytestmark = pytest.mark.django_db


class TestRegistration:
    def test_creates_user_and_profile(self, api_client):
        response = api_client.post(
            reverse("register"),
            {
                "username": "newrunner",
                "email": "new@example.com",
                "password": "TestPass123!",
                "password_confirm": "TestPass123!",
            },
            format="json",
        )
        assert response.status_code == 201

        user = User.objects.get(username="newrunner")
        # The post_save signal must have created this.
        assert user.profile is not None
        assert user.profile.preferred_units == "imperial"
        assert user.profile.default_run_privacy == "followers"

    def test_password_mismatch_rejected(self, api_client):
        response = api_client.post(
            reverse("register"),
            {
                "username": "newrunner",
                "email": "new@example.com",
                "password": "TestPass123!",
                "password_confirm": "Different123!",
                },
            format="json",
        )
        assert response.status_code == 400

    def test_duplicate_email_rejected_case_insensitively(self, api_client, user):
        response = api_client.post(
            reverse("register"),
            {
                "username": "different",
                "email": "RUNNER@EXAMPLE.COM",
                "password": "TestPass123!",
                "password_confirm": "TestPass123!",
            },
            format="json",
        )
        assert response.status_code == 400

    def test_duplicate_username_rejected_case_insensitively(self, api_client, user):
        response = api_client.post(
            reverse("register"),
            {
                "username": "RUNNER",
                "email": "unique@example.com",
                "password": "TestPass123!",
                "password_confirm": "TestPass123!",
            },
            format="json",
        )
        assert response.status_code == 400


class TestLogin:
    def test_login_with_username(self, api_client, user):
        response = api_client.post(
            reverse("login"),
            {"username": "runner", "password": "TestPass123!"},
            format="json",
        )
        assert response.status_code == 200
        assert "access" in response.data

    def test_login_with_email(self, api_client, user):
        """The custom backend must accept email in the username field."""
        response = api_client.post(
            reverse("login"),
            {"username": "runner@example.com", "password": "TestPass123!"},
            format="json",
        )
        assert response.status_code == 200
        assert "access" in response.data

    def test_login_with_email_is_case_insensitive(self, api_client, user):
        response = api_client.post(
            reverse("login"),
            {"username": "RUNNER@EXAMPLE.COM", "password": "TestPass123!"},
            format="json",
        )
        assert response.status_code == 200

    def test_wrong_password_rejected(self, api_client, user):
        response = api_client.post(
            reverse("login"),
            {"username": "runner", "password": "WrongPassword!"},
            format="json",
        )
        assert response.status_code == 401


class TestMeEndpoint:
    def test_requires_authentication(self, api_client):
        assert api_client.get(reverse("me")).status_code == 401

    def test_returns_own_profile(self, auth_client, user):
        response = auth_client.get(reverse("me"))
        assert response.status_code == 200
        assert response.data["username"] == "runner"
        assert "profile" in response.data

    def test_patch_updates_profile(self, auth_client, user):
        response = auth_client.patch(
            reverse("me"),
            {"resting_heart_rate": 52, "max_heart_rate": 185},
            format="json",
        )
        assert response.status_code == 200
        user.profile.refresh_from_db()
        assert user.profile.resting_heart_rate == 52


class TestProfileSignal:
    def test_profile_created_for_superuser(self, db):
        """
        createsuperuser bypasses the registration serializer entirely.
        Without the signal, MeView would raise for these users.
        """
        admin = User.objects.create_superuser(
            username="admin", email="admin@example.com", password="AdminPass123!"
        )
        assert admin.profile is not None

    def test_profile_not_duplicated_on_resave(self, user):
        user.first_name = "Changed"
        user.save()
        assert user.profile is not None