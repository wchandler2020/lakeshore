from django.db.models.signals import post_save
from django.dispatch import receiver
from .models import User, UserProfile

@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    '''Guarantee every user has a profile, however it was created'''
    if created:
        UserProfile.objects.get_or_create(user=instance)