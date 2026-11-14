# Build from the repository root: docker build -f server/Dockerfile -t ncc1701-server .
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY shared ./shared
COPY server ./server
# the simulator ships in this image too: with SIM_EMBED=1 the server starts it (render.yaml)
COPY simulator ./simulator
RUN npm install --omit=dev --no-audit --no-fund --workspace=server --workspace=shared --workspace=simulator
EXPOSE 4000
# PORT, MONGO_URI, JWT_SECRET and DEVICE_KEY come from the environment (Render, Railway, compose)
CMD ["node", "server/src/index.js"]
