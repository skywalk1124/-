# Build stage
FROM node:18-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Production stage
FROM node:18-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY --from=builder /app/dist ./dist
# If you are using server-side tsx or similar, ensure server files are copied/built
# Our build script produces dist/server.cjs
EXPOSE 3000
CMD ["npm", "start"]
