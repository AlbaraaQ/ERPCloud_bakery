FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/web ./apps/web
COPY packages ./packages
RUN npm ci --ignore-scripts && npm run build -w @erpcloud/web
FROM nginx:alpine
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
