# syntax=docker/dockerfile:1

# --- build ------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Manifests first so a source edit does not invalidate the dependency layer.
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .
RUN npm run build

# --- runtime ----------------------------------------------------------------
# The result is static files. Nothing from the build stage — not Node, not
# node_modules — reaches the final image.
FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
