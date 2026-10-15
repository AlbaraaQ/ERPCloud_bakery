FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN npm ci --ignore-scripts && npm run build -w @erpcloud/shared && npx --workspace=@erpcloud/api prisma generate && npm run build -w @erpcloud/api
FROM node:22-alpine
WORKDIR /app
COPY --from=build /repo /app
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
