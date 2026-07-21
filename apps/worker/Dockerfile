FROM node:20-alpine

RUN apk add --no-cache openssl

WORKDIR /app

RUN npm install -g pnpm

COPY . .

RUN pnpm install --frozen-lockfile

RUN pnpm db:generate
RUN pnpm build

CMD ["pnpm", "--filter", "@qb-health/worker", "start"]