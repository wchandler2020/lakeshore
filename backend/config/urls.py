from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularSwaggerView,
)

urlpatterns = [
    path("admin/", admin.site.urls),
    # OpenAPI schema + browsable docs. The schema endpoint is what
    # generates the typed TypeScript client for the React Native app.
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "api/docs/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui",
    ),
    # path("api/auth/", include("accounts.urls")),
    # path("api/routes/", include("routes.urls")),
]
