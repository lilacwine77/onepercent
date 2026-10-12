FROM node:22-alpine AS builder
WORKDIR /workspace/app
RUN npm install --global pnpm@10.34.5
COPY app/ ./
COPY public/assets/crt-poster.webp public/assets/onepercent-machine.webp /workspace/public/assets/
COPY public/assets/tokens/ansem.webp /workspace/public/assets/tokens/ansem.webp
COPY public/models/onepercent-crt.glb /workspace/public/models/onepercent-crt.glb
COPY public/media/onepercent-explained.mp4 public/media/onepercent-explained.webp /workspace/public/media/
RUN pnpm install --frozen-lockfile
RUN pnpm build:libs
RUN node apps/web/scripts/sync-landing-assets.mjs
ARG VITE_API_URL
ARG VITE_TURNSTILE_SITE_KEY
ARG VITE_CLUSTER=devnet
# Public deployment identity, pinned independently of API availability.
ARG CLUSTER
ARG PROGRAM_ID
# Preview builds only (the dev web service): VITE_PREVIEW=1 adds the demo
# adapters that /api/web/config switches per flow. Production leaves it unset;
# the budget and dist:check gate production builds (a preview carries the demo
# code, so neither applies to it).
ARG VITE_PREVIEW
RUN pnpm --filter web build
RUN if [ "$VITE_PREVIEW" = "1" ]; then echo "Preview build: budget and dist:check gate production builds"; \
  else pnpm --filter web budget && pnpm --filter web dist:check; fi
RUN rm -rf apps/web/dist/.vite

FROM caddy:2.11.4-alpine AS runtime
COPY app/apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /workspace/app/apps/web/dist/ /srv/
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
