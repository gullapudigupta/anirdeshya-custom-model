# ─────────────────────────────────────────────────────────────────
# Advanced Quality Tool — Multi-stage Dockerfile
# ─────────────────────────────────────────────────────────────────
# Stage 1 — deps: install production dependencies only
# Stage 2 — runner: minimal runtime image
# ─────────────────────────────────────────────────────────────────

# ── Stage 1: dependency installation ──────────────────────────────
FROM node:20-alpine AS deps

LABEL org.opencontainers.image.title="Advanced Quality Tool"
LABEL org.opencontainers.image.description="AI-powered code quality analysis and auto-fix tool"
LABEL org.opencontainers.image.source="https://github.com/advanced-quality-tool"

WORKDIR /app

# Copy only manifests first for better layer caching
COPY package.json ./

# Install production dependencies (skip devDependencies)
RUN npm install --omit=dev --ignore-scripts && \
    npm cache clean --force

# ── Stage 2: runtime image ─────────────────────────────────────────
FROM node:20-alpine AS runner

# Security: run as non-root user
RUN addgroup -S aqt && adduser -S aqt -G aqt

WORKDIR /app

# Copy production node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY cli.js        ./
COPY src/          ./src/
COPY examples/     ./examples/

# Create writable directories for runtime data
RUN mkdir -p .aqt-cache .aqt-reports .aqt-history \
             .quality-tool/rules \
             .quality-tool/packs \
             .quality-tool/collaboration && \
    chown -R aqt:aqt /app

USER aqt

# Default port for the WebSocket / HTTP UI server
EXPOSE 3000

# Health check — verify the CLI responds
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node cli.js --version || exit 1

# Default entrypoint — can be overridden with any aqt subcommand
ENTRYPOINT ["node", "cli.js"]
CMD ["--help"]
