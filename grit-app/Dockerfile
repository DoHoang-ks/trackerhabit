# ---- deps ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ---- build ---- (giữ full deps: có prisma CLI để migrate/db push)
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# ---- run ---- (ảnh gọn: chỉ standalone output)
FROM node:20-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# standalone server + static + public
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# Prisma client + query engine (standalone đôi khi bỏ sót .node binary)
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/prisma ./prisma
EXPOSE 3000
CMD ["node", "server.js"]
