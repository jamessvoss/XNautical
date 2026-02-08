# Basemap Orchestrator Service
# Lightweight coordinator for tile generation services

FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

ENV PORT=8080
EXPOSE 8080

CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--timeout", "900", "--workers", "2", "server:app"]
