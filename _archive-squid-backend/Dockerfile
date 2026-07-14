# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace and package files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY common/package.json ./common/
COPY squid-backend/package.json ./squid-backend/

# Install pnpm
RUN npm install -g pnpm@9.10.0

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY common ./common
COPY squid-backend ./squid-backend

# Build common package first
WORKDIR /app/common
RUN pnpm build

# Build squid-backend
WORKDIR /app/squid-backend
RUN pnpm build

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9.10.0

# Copy package files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY common/package.json ./common/
COPY squid-backend/package.json ./squid-backend/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts from builder
COPY --from=builder /app/common/dist ./common/dist
COPY --from=builder /app/squid-backend/dist ./squid-backend/dist

# Copy database schemas
COPY database ./database

WORKDIR /app/squid-backend

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["pnpm", "start"]

