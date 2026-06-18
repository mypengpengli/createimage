FROM node:22-alpine

WORKDIR /app
COPY index.html style.css app.js gallery-cases.js server.js ./

ENV PORT=80
EXPOSE 80

CMD ["node", "server.js"]
