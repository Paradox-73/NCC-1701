# Build from the repo root: docker build -f simulator/Dockerfile .
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY shared ./shared
COPY simulator ./simulator
# Install only what the simulator needs; the other workspaces are not copied.
RUN npm pkg set --json 'workspaces=["shared","simulator"]' && npm install --omit=dev --workspace simulator --include-workspace-root=false
ENV SIM_URL=http://server:4000
CMD ["node", "simulator/src/index.js"]
