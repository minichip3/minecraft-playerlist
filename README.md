# 설명
<img width="690" alt="스크린샷 2025-02-18 오전 11 46 25" src="https://github.com/user-attachments/assets/a95d816a-e3b6-4781-85c9-e001ef76002f" />

[닉네임 플러그인](https://github.com/minichip3/minecraft-nickname)과 연동해 마인크래프트 서버에 플레이어 목록을 확인하는 웹사이트.

# Node.js로 사용법
1. `mcplayerlist.js`를 받는다.
2. `npm install express node-fetch`하여 의존성 패키지를 설치한다.
3. 다음 명령어를 실행한다.
```
node mcplayerlist.js -p 3000 your.server.address /path/to/nicknames.json
```
HTTPS로 여는 경우에는 다음과 같은 명령어를 사용한다.
```
node mcplayerlist.js -p 3000 --https-port 3001 --https-cert /path/to/cert --https-key /path/to/key your.server.address /path/to/nicknames.json
```

# Docker로 사용법
기본 사용법
```
docker run -d -p 3000:3000 -e SERVER=your.server.address ghcr.io/minichip3/minecraft-playerlist:latest
```

닉네임 기능과 함께 사용
```
docker run -d -p 3000:3000 -e SERVER=your.server.address -v ${PWD}/nicknames.json:/playerlist/nicknames.json ghcr.io/minichip3/minecraft-playerlist:latest
```
`nicknames.json`파일은 다음과 같은 형식입니다:
```
{
    "uuid1": {
        "nick": "nickname1",
        "name": "playername1"
    },
    "uuid2": {
        "nick": "nickname2",
        "name": "playername2"
    }
}
```

HTTPS 기능과 함께 사용
```
docker run -d -p 3000:3000 -e SERVER=your.server.address -e $HTTPSCERT /cert.pem -e $HTTPSKEY /key.pem -v ${PWD}/nicknames.json:/playerlist/nicknames.json -v ${PWD}/cert/cert.pem:/cert.pem -v ${PWD}/cert/key.pem:/key.pem ghcr.io/minichip3/minecraft-playerlist:latest
```
