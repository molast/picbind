FROM docker.m.daocloud.io/library/node:20-alpine AS deps

WORKDIR /app
RUN npm config set registry https://registry.npmmirror.com \
  && npm install -g pnpm@10 --registry=https://registry.npmmirror.com \
  && pnpm config set registry https://registry.npmmirror.com
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM docker.m.daocloud.io/library/node:20-alpine AS builder

WORKDIR /app
ENV NEXT_OUTPUT_MODE=standalone
ENV NODE_ENV=production
RUN npm config set registry https://registry.npmmirror.com \
  && npm install -g pnpm@10 --registry=https://registry.npmmirror.com \
  && pnpm config set registry https://registry.npmmirror.com

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build

FROM docker.m.daocloud.io/library/node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/standalone ./

EXPOSE 1997
CMD ["node", "server.js"]
