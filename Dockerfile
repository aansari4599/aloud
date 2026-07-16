FROM mcr.microsoft.com/playwright:v1.49.0-jammy
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/aloud.db SCREENSHOT_DIR=/data/shots
EXPOSE 3000
CMD ["npm","run","start"]
