# Use an official Node.js runtime as a parent image
FROM node:26.5.0-bookworm-slim AS production

# Set the working directory in the container to /app
WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package*.json ./

# Install app dependencies with the pinned package manager
RUN npx --yes npm@12.0.1 ci

# Copy the rest of the application
COPY . .

# Run the prestart script before starting the application
RUN npm run prestart

# Your app binds to port 8080
EXPOSE 8080

# Define command to start your application
CMD ["npm", "start"]
