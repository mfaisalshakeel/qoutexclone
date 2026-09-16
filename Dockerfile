# ---- build ----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci

COPY server ./server
COPY web ./web
RUN npx prisma generate --schema server/prisma/schema.prisma \
 && npm run build --workspace=web \
 && npx tsc -p server/tsconfig.json

# ---- runtime --------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY server/package.json ./server/
RUN npm ci --omit=dev --ignore-scripts --workspace=server && npm cache clean --force

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/prisma ./server/prisma
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

EXPOSE 4000
ENV PORT=4000 WEB_DIST=/app/web/dist
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
ENTRYPOINT ["./entrypoint.sh"]
