# Prediction Generator for Cloud Run
# Fetches NOAA tide/current predictions, builds SQLite databases,
# and uploads to Firebase Storage

FROM python:3.11-slim

# Install system dependencies (sqlite3 is included in python:3.11-slim)
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create working directories
WORKDIR /app
RUN mkdir -p /app/temp

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY server.py /app/server.py

# Cloud Run entrypoint
# - 1 worker (processing is sequential per station)
# - Long timeout for large regions (up to 2 hours)
ENV PORT=8080
CMD exec gunicorn --bind :$PORT --workers 1 --threads 4 --timeout 3600 server:app
