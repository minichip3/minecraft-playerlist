FROM node:latest

WORKDIR /app
RUN npm install express node-fetch
COPY ./package.json /app/package.json
COPY ./mcplayerlist.js /app/mcplayerlist.js
COPY ./index.html /app/index.html
COPY ./docker-launch.sh /launch.sh
RUN chmod +x /launch.sh
ENV SERVER=your.server.address
ENV NICKLIST=/playerlist/nicknames.json
ENV PORT=3000
ENV HTTPSPORT=3001
EXPOSE 3000
EXPOSE 3001
ENTRYPOINT [ "sh", "/launch.sh" ]