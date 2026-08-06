FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# GeoDjango needs GDAL, GEOS and PROJ present at the OS level.
# This is the #1 cause of "it works in Docker but not on my laptop" —
# on macOS you'd need `brew install gdal geos proj`. Working inside
# the container avoids that entirely, which matters when your teammate
# is ramping up.
RUN apt-get update && apt-get install -y --no-install-recommends \
        binutils \
        libproj-dev \
        gdal-bin \
        libgdal-dev \
        libgeos-dev \
        postgresql-client \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
