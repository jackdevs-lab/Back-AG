FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy source code and config
COPY . .

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build packages
RUN pnpm db:generate
RUN pnpm build

# Expose port
EXPOSE 3000

# Start application
CMD ["pnpm", "--filter", "@qb-health/api", "start"]