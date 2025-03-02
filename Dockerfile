FROM node:latest

WORKDIR /app
COPY ./package.json /app/package.json
COPY ./mcplayerlist.js /app/mcplayerlist.js
COPY ./docker-launch.sh /launch.sh
RUN chmod +x /launch.sh
RUN npm install express node-fetch
ENV SERVER=your.server.address
ENV NICKLIST=/playerlist/nicknames.json
ENV PORT=3000
ENV HTTPSPORT=3001
EXPOSE 3000
EXPOSE 3001
ENTRYPOINT [ "sh", "/launch.sh" ]