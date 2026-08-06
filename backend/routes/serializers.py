"""
routes/serializers.py
"""

from rest_framework import serializers

MILES_TO_METERS = 1609.344
KM_TO_METERS = 1000.0

# GraphHopper struggles below ~1km (not enough road network to close a
# loop) and gets slow above ~50km.
MIN_DISTANCE_M = 800
MAX_DISTANCE_M = 50_000


class RouteRequestSerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lng = serializers.FloatField(min_value=-180, max_value=180)
    distance = serializers.FloatField(min_value=0.1)
    units = serializers.ChoiceField(
        choices=["mi", "km", "m"], default="mi"
    )
    profile = serializers.ChoiceField(
        choices=["foot", "bike"], default="foot"
    )
    samples = serializers.IntegerField(
        default=8, min_value=1, max_value=20,
        help_text="How many seeds to try. More is slower but more accurate.",
    )
    count = serializers.IntegerField(
        default=3, min_value=1, max_value=10,
        help_text="How many ranked routes to return.",
    )

    def validate(self, attrs):
        units = attrs["units"]
        raw = attrs["distance"]

        if units == "mi":
            meters = raw * MILES_TO_METERS
        elif units == "km":
            meters = raw * KM_TO_METERS
        else:
            meters = raw

        if not MIN_DISTANCE_M <= meters <= MAX_DISTANCE_M:
            raise serializers.ValidationError({
                "distance": (
                    f"Distance must be between {MIN_DISTANCE_M}m and "
                    f"{MAX_DISTANCE_M}m (about 0.5 to 31 miles)."
                )
            })

        attrs["distance_m"] = meters
        return attrs