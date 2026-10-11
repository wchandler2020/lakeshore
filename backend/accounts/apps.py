from django.apps import AppConfig


class AccountsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'accounts'

    def ready(self):
        # Imported for its side effect: registers the post_save handler that
        # creates each user's UserProfile. Removing it breaks signup.
        from . import signals  # noqa: F401
