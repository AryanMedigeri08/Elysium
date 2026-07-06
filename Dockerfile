# Stage 1: Build React Frontend
FROM node:20 AS frontend-builder
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Serve via FastAPI Backend
FROM python:3.11-slim
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Copy built frontend assets from Stage 1
COPY --from=frontend-builder /frontend/dist /app/frontend/dist

# Expose port (Cloud Run default)
EXPOSE 8080

# Run FastAPI backend server
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
