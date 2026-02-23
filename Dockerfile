# Cloud Run Dockerfile for FastAPI backend
FROM python:3.12-slim

# Install Tesseract OCR + fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy shared Python modules first (models, utils)
COPY models/ models/
COPY utils/  utils/

# Copy backend source
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ backend/

ENV PORT=8080
ENV STORAGE_BUCKET=pdf-text-extraction-488009.firebasestorage.app
EXPOSE 8080

CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8080"]
