# syntax=docker/dockerfile:1

ARG NODE_IMAGE=cicd.gomlamarket.com:5000/mirror/node:22-alpine

FROM ${NODE_IMAGE}

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY . .

RUN chown -R node:node /app
USER node

EXPOSE 3000

CMD ["node", "src/index.js"]
