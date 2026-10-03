FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

COPY . .
RUN mkdir -p /opt/admin/logs

EXPOSE 3075

CMD ["sh", "-c", "npm run seed && node server.js"]
