# syntax=docker/dockerfile:1
# Docker image provides the MCP SSE server + WebSocket endpoint.
# Chrome stays installed and logged-in on the host computer.
FROM node:22-bookworm-slim AS build
WORKDIR /source
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile \
    && pnpm --filter @wechatsync/mcp-server run build
RUN mkdir -p /bundle \
    && cp packages/mcp-server/package.json /bundle/ \
    && cp -a packages/mcp-server/dist /bundle/dist \
    && cd /bundle \
    && npm install --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

FROM node:22-bookworm-slim
LABEL org.opencontainers.image.title="Baize Wechatsync MCP Server"
LABEL org.opencontainers.image.source="https://github.com/edyang/Wechatsync"
LABEL org.opencontainers.image.description="MCP SSE bridge to host Chrome Wechatsync extension"
ENV NODE_ENV=production \
    SYNC_WS_HOST=0.0.0.0 \
    SYNC_WS_PORT=9527 \
    SYNC_HTTP_HOST=0.0.0.0 \
    SYNC_HTTP_PORT=9528 \
    SYNC_BRIDGE_API_PORT=9529 \
    HOME=/tmp
RUN groupadd --gid 10001 wechatsync \
    && useradd --uid 10001 --gid 10001 --no-create-home \
       --home-dir /nonexistent --shell /usr/sbin/nologin wechatsync
WORKDIR /app
COPY --from=build --chown=10001:10001 /bundle/ /app/
USER 10001:10001
EXPOSE 9527/tcp 9528/tcp
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e 'const r=require("node:http").get("http://127.0.0.1:9528/health",s=>{process.exitCode=s.statusCode===200?0:1;s.resume()});r.setTimeout(3000,()=>r.destroy());r.on("error",()=>process.exit(1))'
CMD ["node", "dist/index.js", "--sse"]
