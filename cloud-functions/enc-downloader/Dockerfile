# ENC Downloader for Cloud Run
# Downloads NOAA ENC data by USCG district and uploads to Firebase Storage

FROM python:3.11-slim

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app.py .

# Use gunicorn for production
# Timeout set to 3600s (1 hour) to handle large district downloads
CMD exec gunicorn --bind :$PORT --workers 1 --threads 2 --timeout 3600 app:app
