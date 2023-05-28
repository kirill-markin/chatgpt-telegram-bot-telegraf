# Use an official Ubuntu runtime as a parent image
FROM ubuntu:latest

# Make sure that we have the latest packages
RUN apt-get update && apt-get upgrade -y

# Install ffmpeg and Node.js
RUN apt-get install -y ffmpeg curl
RUN curl -sL https://deb.nodesource.com/setup_14.x | bash -
RUN apt-get install -y nodejs

# Verify Node.js is installed
RUN node -v
RUN npm -v

# Set the working directory in the container to /app
WORKDIR /app

# Copy the current directory contents into the container at /app
COPY . /app

# If you have a package.json, use the following commands to build your application:
RUN npm install

# Your app binds to port 8080 so you'll use the EXPOSE instruction to have it mapped by the docker daemon
EXPOSE 8080

# Define command to start your application
CMD ["npm", "start"]
