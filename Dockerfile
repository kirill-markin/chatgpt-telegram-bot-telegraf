FROM node:26.12.1-bookworm-slim AS production

WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package*.json ./

RUN npx --yes npm@12.0.2 ci

COPY . .

RUN npm run prestart

EXPOSE 8080

CMD ["npm", "start"]
