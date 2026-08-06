"""
accounts/backends.py

Custom authentication backend: tries the submitted identifier against
both username and email, case-insensitively. Register this in
settings.AUTHENTICATION_BACKENDS ahead of the default ModelBackend.
"""

from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend
from django.db.models import Q

User = get_user_model()


class EmailOrUsernameModelBackend(ModelBackend):
    def authenticate(self, request, username=None, password=None, **kwargs):
        if username is None:
            username = kwargs.get(User.USERNAME_FIELD)
        if username is None or password is None:
            return None

        try:
            user = User.objects.get(
                Q(username__iexact=username) | Q(email__iexact=username)
            )
        except User.DoesNotExist:
            # Run the hasher anyway to keep response timing consistent
            # and avoid leaking whether an account exists.
            User().set_password(password)
            return None
        except User.MultipleObjectsReturned:
            # Shouldn't happen given email is unique, but guard anyway.
            user = User.objects.filter(
                Q(username__iexact=username) | Q(email__iexact=username)
            ).order_by("id").first()

        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None