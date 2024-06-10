# Use an official Node.js runtime as a parent image
FROM node:22

# Set the working directory in the container to /app
WORKDIR /app

# Copy the current directory contents into the container at /app
COPY . /app

# Install app dependencies
RUN npm install

# Your app binds to port 8080 so you'll use the EXPOSE instruction to have it mapped by the docker daemon
EXPOSE 8080

# Define command to start your application
CMD ["npm", "start"]
