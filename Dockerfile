FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1
ENV PORT=4173

COPY server.py app.js index.html styles.css README.md schema.sql requirements.txt migrate_postgres.py entrypoint.sh .env.example ./
COPY assets ./assets

# The preview server uses the standard library. Install optional production
# migration dependencies in the image so schema deployment is one command.
RUN pip install --no-cache-dir -r requirements.txt && chmod +x entrypoint.sh

EXPOSE 4173
ENTRYPOINT ["./entrypoint.sh"]
