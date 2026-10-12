FROM node:22-alpine AS builder
WORKDIR /workspace
RUN npm install --global pnpm@10.34.5

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "api..." build && pnpm --filter api deploy --legacy --prod /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder --chown=node:node /out ./
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
