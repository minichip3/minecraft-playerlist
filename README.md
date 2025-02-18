# Preview
<img width="690" alt="스크린샷 2025-02-18 오전 11 46 25" src="https://github.com/user-attachments/assets/a95d816a-e3b6-4781-85c9-e001ef76002f" />

# Docker Usage
Basic Usage
`docker run -d -p 3000:3000 -e SERVER=your.server.address ghcr.io/minichip3/minecraft-playerlist:latest`

With Nickname Feature
`docker run -d -p 3000:3000 -e SERVER=your.server.address -v ${PWD}/nicknames.json:/playerlist/nicknames.json ghcr.io/minichip3/minecraft-playerlist:latest`
`nicknames.json`File should be like this:
```
{
  "player1": "nickname1",
  "player2": "nickname2",
  "player3": "nickname3"
}
```
