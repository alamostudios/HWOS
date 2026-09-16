FROM node:22-bookworm-slim
WORKDIR /app
COPY . .
RUN rm -f package-lock.json && npm install --omit=dev
EXPOSE 5000
CMD ["node", "server/index.js"]
