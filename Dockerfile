# Use an official Node.js runtime as a parent image
FROM node:20-slim

# Set the working directory in the container to /app
WORKDIR /app

# Copy the current directory contents into the container at /app
COPY . /app

# Install app dependencies
RUN npm install

# Your app binds to port 8080 so you'll use the EXPOSE instruction to have it mapped by the docker daemon
EXPOSE 8080

# Run the prestart script before starting the application
RUN npm run prestart

# Define command to start your application
CMD ["npm", "start"]
