# --- Build Stage ---
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++ 

# Copy package files
COPY package*.json ./
RUN npm ci

# Copy the rest
COPY . .
RUN node scripts/build-plugin-backend.js
RUN npm run build

# --- Runtime Stage ---
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

# Install production dependencies and GLOBAL TOOLS
ARG CACHE_BUST=1
COPY package*.json ./
RUN npm install --no-audit

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/plugins ./plugins
COPY --from=builder /app/public ./public
COPY --from=builder /app/client/public ./client/public
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/server ./server
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/scripts ./scripts

RUN mkdir -p client/public/uploads logs data plugins

EXPOSE 5000

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--no-warnings", "--import", "tsx", "dist/index.js"]
