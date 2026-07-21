FROM node:20-alpine

RUN apk add --no-cache openssl

WORKDIR /app
RUN npm install -g pnpm

COPY . .

RUN pnpm install --frozen-lockfile

RUN pnpm db:generate
RUN pnpm build

EXPOSE 3000

CMD ["pnpm", "--filter", "@qb-health/api", "start"]