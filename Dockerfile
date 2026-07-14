# Use a slim Node.js 20 Debian image (required for apt-get)
FROM node:20-bookworm-slim

# Install Stockfish and OpenSSL (required for Prisma)
RUN apt-get update && apt-get install -y stockfish openssl && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code and prisma schema
COPY . .

# Provide a dummy DATABASE_URL for the build step so prisma.config.ts doesn't crash.
# Render will override this with your actual database URL at runtime.
ENV DATABASE_URL="postgresql://postgres:password@localhost:5432/postgres"

# Generate Prisma client
RUN npx prisma generate

# Build TypeScript code
RUN npm run build

# Expose port (Render defaults to looking for port 8080 or PORT env)
EXPOSE 8080

# Start the server
CMD [ "npm", "start" ]
