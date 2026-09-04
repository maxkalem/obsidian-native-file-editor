# Dockerfile: multi-stage build, ARG, ENV, HEALTHCHECK.
FROM node:22-alpine AS build
ARG NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit && npm run build

FROM node:22-alpine
ENV NODE_ENV=${NODE_ENV} PORT=8080
WORKDIR /app
COPY --from=build /app/main.js ./
EXPOSE 8080
HEALTHCHECK --interval=30s CMD wget -qO- http://localhost:8080/health || exit 1
ENTRYPOINT ["node", "main.js"]
