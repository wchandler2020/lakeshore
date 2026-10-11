"""
accounts/tests/test_seed_dev.py
"""

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from accounts.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def debug(settings):
    settings.DEBUG = True


class TestSeedDev:
    def test_creates_dev_user_with_profile(self, debug):
        call_command("seed_dev")

        user = User.objects.get(email="dev@lakeshore.test")
        assert user.username == "dev"
        assert user.check_password("devpassword")
        assert user.profile is not None

    def test_is_idempotent_and_resets_password(self, debug):
        call_command("seed_dev")
        user = User.objects.get(email="dev@lakeshore.test")
        user.set_password("changed")
        user.save()

        call_command("seed_dev")

        assert User.objects.filter(email="dev@lakeshore.test").count() == 1
        user.refresh_from_db()
        assert user.check_password("devpassword")

    def test_refuses_without_debug(self, settings):
        settings.DEBUG = False
        with pytest.raises(CommandError):
            call_command("seed_dev")
        assert not User.objects.filter(email="dev@lakeshore.test").exists()
