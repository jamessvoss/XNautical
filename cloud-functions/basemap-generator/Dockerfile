# Basemap Vector Tile Generator for Cloud Run
# Downloads OpenMapTiles PBF vector tiles and packages into MBTiles
# Uses Natural Earth land data for coastal buffer filtering

FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Download Natural Earth 10m land polygons (~4 MB shapefile)
# Used for coastal buffer filtering to avoid downloading open ocean tiles
RUN mkdir -p /app/data && \
    curl -L -o /tmp/ne_10m_land.zip \
      "https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip" && \
    unzip /tmp/ne_10m_land.zip -d /app/data/ne_10m_land && \
    rm /tmp/ne_10m_land.zip

# Create working directories
WORKDIR /app
RUN mkdir -p /app/temp

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY server.py /app/server.py

# Cloud Run entrypoint
# - 1 worker (async handles concurrency internally)
# - Long timeout for large downloads (up to 2 hours)
ENV PORT=8080
CMD exec gunicorn --bind :$PORT --workers 1 --threads 4 --timeout 7200 server:app
