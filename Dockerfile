# Use an official Node.js runtime as a parent image
# Updated for Railway deployment - Node.js 20 LTS
FROM node:20-slim AS production

# Set the working directory in the container to /app
WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package*.json ./

# Install app dependencies
RUN npm ci

# Copy the rest of the application
COPY . .

# Run the prestart script before starting the application
RUN npm run prestart

# Your app binds to port 8080
EXPOSE 8080

# Define command to start your application
CMD ["npm", "start"]
