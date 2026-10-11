"""
accounts/management/commands/seed_dev.py

Creates or updates a known login for local development:
dev@lakeshore.test / devpassword (username "dev"). Safe to run
repeatedly — it resets the password and profile each time rather than
failing or duplicating.
"""

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from accounts.models import User, UserProfile

EMAIL = "dev@lakeshore.test"
USERNAME = "dev"
PASSWORD = "devpassword"


class Command(BaseCommand):
    help = f"Create or update the dev login ({EMAIL} / {PASSWORD}). DEBUG only."

    def handle(self, *args, **options):
        # A well-known password must never land in a real deployment.
        if not settings.DEBUG:
            raise CommandError("seed_dev only runs with DEBUG=True.")

        user, created = User.objects.get_or_create(
            email=EMAIL, defaults={"username": USERNAME}
        )
        user.set_password(PASSWORD)
        user.is_active = True
        user.save()
        # The post_save signal makes a profile for new users; this covers
        # an existing user from before the signal existed.
        UserProfile.objects.get_or_create(user=user)

        verb = "Created" if created else "Updated"
        self.stdout.write(self.style.SUCCESS(f"{verb} {EMAIL} / {PASSWORD}"))
