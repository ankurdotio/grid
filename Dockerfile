FROM node:22-alpine AS web-build
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-alpine AS server-build
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV STATIC_DIR=/app/web/dist
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=server-build /build/server/dist ./dist
COPY --from=web-build /build/web/dist /app/web/dist
EXPOSE 3000
CMD ["npm", "start"]
