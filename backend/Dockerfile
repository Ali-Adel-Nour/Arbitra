# syntax = docker/dockerfile:1
FROM node:22-slim

# Install OpenSSL for Prisma
RUN apt-get update -y && apt-get install -y openssl ca-certificates

WORKDIR /app

COPY package.json ./

RUN npm install

COPY . .

# Remove local .env and dev databases to prevent them from breaking the production deployment
RUN rm -f .env prisma/*.db *.db

# Generate prisma client
RUN npx prisma generate

# Install typescript globally to fix 'tsc: not found'
RUN npm install -g typescript

# Install missing type definitions
RUN npm install -D @types/node @types/mocha

# Build typescript
RUN npm run build

EXPOSE 3000

# Run migrations and start the server
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
