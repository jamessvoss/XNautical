# Basemap Vector Tile Generator for Cloud Run
# Downloads OpenMapTiles PBF vector tiles and packages into MBTiles
# Uses Natural Earth land data for coastal buffer filtering

FROM python:3.11.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Download Natural Earth 10m land polygons (~4 MB shapefile)
# Used for coastal buffer filtering to avoid downloading open ocean tiles
ENV NE_LAND_SHA256=e547d749445eaa0964aba76738090ec88f5e63c4585122170f98c67a7ea922dc
RUN mkdir -p /app/data && \
    (curl -L -o /tmp/ne_10m_land.zip \
      "https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip" \
    || curl -L -o /tmp/ne_10m_land.zip \
      "https://storage.googleapis.com/xnautical-assets/ne_10m_land.zip") && \
    echo "$NE_LAND_SHA256  /tmp/ne_10m_land.zip" | sha256sum -c - && \
    unzip /tmp/ne_10m_land.zip -d /app/data/ne_10m_land && \
    rm /tmp/ne_10m_land.zip

# Create working directories
WORKDIR /app
RUN mkdir -p /app/temp

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy shared modules first (change less often, better layer caching)
COPY tile_utils.py /app/tile_utils.py
COPY config.py /app/config.py

# Copy application
COPY server.py /app/server.py

# Cloud Run entrypoint
# - 2 workers so /status can respond while /generate runs (separate GILs)
# - Long timeout for large downloads (up to 1 hour)
ENV PORT=8080
CMD exec gunicorn --bind :$PORT --workers 2 --threads 4 --timeout 3600 --preload server:app
