# Stage 1: Build the React application
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Stage 2: Serve the application with Nginx
FROM nginx:alpine

# Copy the nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the built files from the build stage
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /app/node_modules/cesium/Build/Cesium /usr/share/nginx/html/Cesium

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
