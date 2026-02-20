# ENC to MBTiles Converter for Cloud Run
# Uses pre-built base image with tippecanoe, GDAL, and Python deps.
# To rebuild base: gcloud builds submit --config=cloudbuild-base.yaml

FROM gcr.io/xnautical-8a296/enc-converter-base:latest

# Copy converter scripts
COPY convert.py /app/convert.py
COPY batch_convert.py /app/batch_convert.py
COPY server.py /app/server.py
COPY merge_job.py /app/merge_job.py
COPY compose_job.py /app/compose_job.py
COPY merge_utils.py /app/merge_utils.py

# Make job scripts executable
RUN chmod +x /app/merge_job.py /app/compose_job.py

# TypeScript S-57 parser: install deps and compile
COPY src/ /app/src/
COPY package.json tsconfig.json /app/
RUN cd /app && npm install && npx tsc

# Cloud Run entrypoint (Flask via gunicorn for Service, or merge_job.py for Job)
ENV PORT=8080
CMD exec gunicorn --bind :$PORT --workers 1 --threads 2 --timeout 3600 server:app
