"""Test settings. Used by pytest and CI."""

from .base import *  # noqa: F401,F403

DEBUG = False

# Fast, insecure hashing — meaningful speedup on auth-heavy test suites.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

# Run Celery tasks inline instead of dispatching to a worker.
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
