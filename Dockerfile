FROM node:latest

WORKDIR /app
COPY ./package.json /app/package.json
COPY ./mcplayerlist.js /app/mcplayerlist.js
RUN npm install express node-fetch
ENV SERVER=your.server.address
ENV NICKLIST=/playerlist/nicknames.json
ENV PORT=3000
EXPOSE 3000
ENTRYPOINT [ "sh", "-c", "node /app/mcplayerlist.js -p $PORT $SERVER $NICKLIST"]