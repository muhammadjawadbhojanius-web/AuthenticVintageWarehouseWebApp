FROM python:3.12-slim

# Install ffmpeg (needed for video transcoding)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY backend/app ./app

# Create uploads directory
RUN mkdir -p uploads

EXPOSE 8080

# Generous timeouts so long ffmpeg jobs (kicked off as BackgroundTasks)
# don't kill the worker, and so the keep-alive header on the chunked-upload
# polling loop is honoured.
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8080", \
     "--timeout-keep-alive", "75", \
     "--timeout-graceful-shutdown", "30", \
     "--limit-concurrency", "100"]
