# Use an official Ubuntu runtime as a parent image
FROM ubuntu:22.04

# Make sure that we have the latest packages
RUN apt-get update && apt-get upgrade -y

# Update the sources list to use a different mirror
RUN sed -i 's|http://archive.ubuntu.com/ubuntu/|http://mirror.math.princeton.edu/pub/ubuntu/|g' /etc/apt/sources.list

# Clean up apt cache to remove any corrupted packages
RUN apt-get clean && rm -rf /var/lib/apt/lists/*

# Retry mechanism for installing ffmpeg and required packages for Node.js setup
RUN apt-get update && apt-get install -y --fix-missing ffmpeg curl lsb-release gnupg || \
    apt-get clean && rm -rf /var/lib/apt/lists/* && \
    apt-get update && apt-get install -y --fix-missing ffmpeg curl lsb-release gnupg

# Set up NodeSource repository and install Node.js 22.x
RUN curl -sL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --fix-missing nodejs

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
