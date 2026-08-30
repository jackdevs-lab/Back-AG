FROM node:20-alpine

RUN apk add --no-cache openssl

WORKDIR /app

RUN npm install -g pnpm@9.15.9
COPY . .

RUN pnpm install --frozen-lockfile --config.ignore-scripts=false
RUN pnpm --filter @qb-health/financial-model db:generate
RUN pnpm --filter @qb-health/worker... build
CMD ["pnpm", "--filter", "@qb-health/worker", "start"]