FROM node:22-alpine AS build
# OpenSSL must exist BEFORE `prisma generate` so the generated query engine
# targets linux-musl-openssl-3.0.x (matching the runtime image). Without it
# the client generates a 1.1.x engine and crashes at first DB connection
# with PrismaClientInitializationError despite a green docker build.
RUN apk add --no-cache openssl libc6-compat
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN npm ci --ignore-scripts && npm run build -w @erpcloud/shared && npx --workspace=@erpcloud/api prisma generate && npm run build -w @erpcloud/api
FROM node:22-alpine
# Prisma engines on Alpine require OpenSSL + glibc compatibility at RUNTIME
# (without this, migrate/API crash on first Prisma call despite a green build)
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
COPY --from=build /repo /app
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
