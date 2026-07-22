FROM python:3.11-slim

WORKDIR /app

# 拷贝后端与前端文件
COPY backend/ /app/backend/
COPY frontend/ /app/frontend/

EXPOSE 8000

ENV PYTHONUNBUFFERED=1

CMD ["python3", "/app/backend/main.py"]
