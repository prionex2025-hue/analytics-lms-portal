FROM node:22-alpine AS builder
WORKDIR /app

ARG VITE_API_BASE_URL=/api
ARG VITE_SOCKET_URL=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_SOCKET_URL=${VITE_SOCKET_URL}

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.js jsconfig.json components.json tailwind.config.js ./
COPY public ./public
COPY scripts ./scripts
COPY src ./src
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O - http://localhost/ >/dev/null || exit 1
