FROM node:20-alpine AS builder
WORKDIR /workspace

# Install deps first for layer caching
COPY server/package*.json server/
COPY client/package*.json client/
RUN cd server && npm ci
RUN cd client && npm ci

COPY server/ server/
COPY client/ client/

RUN cd server && npm run build
RUN cd client && npm run build

FROM node:20-alpine AS runtime
WORKDIR /app

COPY --from=builder /workspace/server/dist  server/dist
COPY --from=builder /workspace/client/dist  client/dist
COPY server/package*.json                   server/

RUN cd server && npm ci --omit=dev

EXPOSE 8080
CMD ["node", "server/dist/index.js"]
