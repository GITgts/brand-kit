# syntax=docker/dockerfile:1
# Build from the repo root:  docker build -f apps/brand-service/Dockerfile -t brand-service .

FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile --filter "brand-service..."
RUN pnpm --filter "brand-service..." build
RUN pnpm --filter brand-service deploy --prod /out

# Chromium + system deps. Keep the tag equal to the playwright-core version.
FROM mcr.microsoft.com/playwright:v1.63.0-noble
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY --from=build /out ./
# Brand font for monogram outlines (set BRAND_MONOGRAM_FONT_PATH=/app/fonts/<file>).
COPY apps/brand-service/fonts ./fonts
USER pwuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
