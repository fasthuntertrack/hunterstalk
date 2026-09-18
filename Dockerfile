FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
ENV PORT=3847
EXPOSE 3847
CMD ["node", "server.js"]
