# Use an official Node.js runtime as the base image
FROM node:20-alpine

RUN apk add --no-cache openssl

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm ci || npm install

# Copy the Prisma schema and generate the Prisma client
# RUN cd src/db && npx prisma generate && cd ../..

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on
EXPOSE 5000

# Command to run the application
CMD ["npm", "start"]