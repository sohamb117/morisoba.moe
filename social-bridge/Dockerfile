FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py x_compat.py instagram_web.py instagram_chat.py ./
RUN useradd --create-home app
USER app
ENV PORT=8080
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT} --no-access-log --log-level critical"]
