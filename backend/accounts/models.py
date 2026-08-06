from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    email = models.EmailField(unique=True)

    # Both username and email are usable to log in (see
    # accounts/backends.py). USERNAME_FIELD stays "username" so
    # createsuperuser and Django admin behave normally; email
    # uniqueness is enforced at the DB level regardless.
    REQUIRED_FIELDS = ["email"]

    def __str__(self):
        return self.username


class UserProfile(models.Model):
    """
    Athlete profile. Kept off User deliberately — auth concerns stay
    separate from domain data.
    """

    UNIT_CHOICES = [
        ("metric", "Metric"),
        ("imperial", "Imperial"),
    ]

    PRIVACY_CHOICES = [
        ("public", "Public"),
        ("followers", "Followers only"),
        ("private", "Private"),
    ]

    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name="profile",
    )
    height_cm = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    weight_kg = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    preferred_units = models.CharField(max_length=10, choices=UNIT_CHOICES, default="imperial")

    # Training zones are derived from these. Both optional — most
    # users won't know them, and we can estimate from age if needed.
    resting_heart_rate = models.PositiveSmallIntegerField(null=True, blank=True)
    max_heart_rate = models.PositiveSmallIntegerField(null=True, blank=True)

    # Default visibility for new activities. Individual runs can
    # override this.
    default_run_privacy = models.CharField(
        max_length=10, choices=PRIVACY_CHOICES, default="followers"
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Profile<{self.user.username}>"
