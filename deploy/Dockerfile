FROM node:22-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data TRUST_PROXY=1
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/saglik || exit 1
CMD ["node", "--no-warnings", "server.js"]
