FROM node:latest

WORKDIR /app
COPY ./package.json /app/package.json
COPY ./mcplayerlist.js /app/mcplayerlist.js
RUN npm install express node-fetch
ENV SERVER=your.server.address
ENV NICKLIST=/playerlist/nicknames.json
ENTRYPOINT [ "sh", "-c", "node /app/mcplayerlist.js $SERVER $NICKLIST"]