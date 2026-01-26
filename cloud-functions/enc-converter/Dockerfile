# ENC to MBTiles Converter for Cloud Run
# Based on enc-mapbox-converter with Firebase Storage integration

FROM ubuntu:22.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    gdal-bin \
    libgdal-dev \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install tippecanoe (Mapbox tool for creating vector tiles)
RUN git clone https://github.com/mapbox/tippecanoe.git /tmp/tippecanoe \
    && cd /tmp/tippecanoe \
    && make -j$(nproc) \
    && make install \
    && rm -rf /tmp/tippecanoe

# Install Google Cloud SDK
RUN curl -sSL https://sdk.cloud.google.com | bash
ENV PATH="/root/google-cloud-sdk/bin:${PATH}"

# Install Python dependencies
RUN pip3 install google-cloud-storage

# Create working directories
WORKDIR /app
RUN mkdir -p /app/input /app/output /app/temp

# Copy converter script
COPY convert.py /app/convert.py
COPY batch_convert.py /app/batch_convert.py

# Set entrypoint
ENTRYPOINT ["python3", "/app/batch_convert.py"]
