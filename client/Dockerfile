# Build from the repository root: docker build -f client/Dockerfile --build-arg VITE_API_URL=http://localhost:4000 -t ncc1701-client .
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json ./
COPY shared ./shared
COPY client ./client
RUN npm install --no-audit --no-fund --workspace=client --workspace=shared
ARG VITE_API_URL=http://localhost:4000
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build -w client

FROM nginx:1.27-alpine
COPY --from=build /app/client/dist /usr/share/nginx/html
# Single-page app: unknown paths serve index.html; hashed assets cache for a year.
RUN printf 'server {\n  listen 80;\n  gzip on;\n  gzip_min_length 1024;\n  gzip_types text/javascript application/javascript text/css application/json image/svg+xml;\n  root /usr/share/nginx/html;\n  location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; try_files $uri =404; }\n  location / { try_files $uri /index.html; }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
