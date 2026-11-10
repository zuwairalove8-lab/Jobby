# JOBBY browser worker — a small Playwright service.
# Build: docker build -t jobby-browser-worker browser-worker
# Run:   docker run -p 8787:8787 -e BROWSER_WORKER_TOKEN=... jobby-browser-worker
FROM mcr.microsoft.com/playwright:v1.65.0-noble

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY server.mjs ./

ENV PORT=8787
EXPOSE 8787

RUN useradd --create-home --uid 10001 jobby && chown -R jobby:jobby /app
USER jobby

CMD ["node", "server.mjs"]
