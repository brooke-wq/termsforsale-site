FROM mcr.microsoft.com/playwright:v1.46.0-jammy

WORKDIR /app

# Install deps separately for better cache utilization
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy source
COPY . .

ENV NODE_ENV=production
EXPOSE 3100

CMD ["node", "server.js"]
