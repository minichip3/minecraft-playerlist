const express = require('express');
const fetch = require('node-fetch').default; // node-fetch v3 사용 (.default 추가)
const fs = require('fs');
const path = require('path');
const app = express();
const port = 3000;

// IP 로깅 미들웨어 (프록시 뒤에 있을 경우를 대비해 trust proxy 설정도 필요할 수 있음)
// app.set('trust proxy', true);
app.use((req, res, next) => {
  const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  console.log(`Request from IP: ${clientIp}`);
  next();
});

// 커맨드라인 인수: process.argv[2]는 서버 주소, process.argv[3]는 닉네임 파일 경로 (선택)
const serverIp = process.argv[2];
if (!serverIp) {
  console.error("Usage: node mcplayerlist.js your.server.address [nicknames_file]");
  process.exit(1);
}
console.log(`Using Minecraft server address: ${serverIp}`);

let nickFilePath = process.argv[3] || null; // 닉네임 파일 경로가 제공되면 사용, 아니면 null

// 닉네임 데이터는 기본적으로 빈 객체입니다.
let nicknames = {};

// 만약 닉네임 파일이 제공되었다면 파일을 로드합니다.
if (nickFilePath) {
  nickFilePath = path.isAbsolute(nickFilePath)
    ? nickFilePath
    : path.join(__dirname, nickFilePath);
  try {
    if (fs.existsSync(nickFilePath)) {
      const data = fs.readFileSync(nickFilePath, 'utf-8');
      nicknames = JSON.parse(data);
      console.log("닉네임 데이터 로드 완료:", nicknames);
    } else {
      console.warn(`경고: 닉네임 파일이 존재하지 않습니다 (${nickFilePath}). 빈 닉네임 데이터로 진행합니다.`);
      nicknames = {};
    }
  } catch (err) {
    console.error("닉네임 파일 로드 실패:", err);
    nicknames = {};
  }
} else {
  console.log("닉네임 파일 미지정: 플레이어 닉네임은 표시되지 않습니다.");
}

// --------------------
// 플레이어 데이터 캐시 (메모리 내, TTL: 10분)
// --------------------
const playerCache = {};
const CACHE_TTL = 10 * 60 * 1000; // 10분

function getCachedPlayer(username) {
  const entry = playerCache[username];
  if (entry && (Date.now() - entry.timestamp < CACHE_TTL)) {
    return entry.data;
  }
  return null;
}

function setCachedPlayer(username, data) {
  playerCache[username] = { data, timestamp: Date.now() };
}

// --------------------
// 사전 업데이트: 플레이어 데이터를 10분마다 업데이트
// --------------------
async function updateAllPlayers() {
  try {
    const statusResponse = await fetch(`https://api.mcsrvstat.us/2/${serverIp}`);
    const statusData = await statusResponse.json();

    if (!statusData.online) {
      console.log("서버가 오프라인입니다. 플레이어 데이터 업데이트 건너뜁니다.");
      return;
    }

    const players = statusData.players.list || [];
    console.log("사전 업데이트할 플레이어 목록:", players);

    await Promise.all(players.map(async username => {
      try {
        const response = await fetch(`https://api.ashcon.app/mojang/v2/user/${username}`);
        const data = await response.json();
        setCachedPlayer(username, data);
      } catch (err) {
        console.error(`Preload failed for ${username}:`);
      }
    }));
  } catch (err) {
    console.error("플레이어 데이터를 사전 업데이트하는 중 오류 발생:", err);
  }
}

// 초기 사전 업데이트 실행 및 10분마다 반복
updateAllPlayers();
setInterval(updateAllPlayers, CACHE_TTL);

// --------------------
// /status 엔드포인트: 서버 상태 및 플레이어 목록 집계
// --------------------
app.get('/status', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const statusResponse = await fetch(`https://api.mcsrvstat.us/2/${serverIp}`);
    const statusData = await statusResponse.json();

    if (!statusData.online) {
      return res.json({ online: false, message: "서버 오프라인" });
    }

    const players = statusData.players.list || [];

    const playersData = await Promise.all(players.map(async username => {
      let playerData = getCachedPlayer(username);
      if (!playerData) {
        try {
          const response = await fetch(`https://api.ashcon.app/mojang/v2/user/${username}`);
          playerData = await response.json();
          setCachedPlayer(username, playerData);
        } catch (err) {
          console.error(`Preload failed for ${username}:`);
          playerData = null;
        }
      }
      let headImageUrl = "";
      if (playerData && playerData.uuid) {
        headImageUrl = `https://crafatar.com/avatars/${playerData.uuid}?size=32&overlay&ts=${playerCache[username] ? playerCache[username].timestamp : Date.now()}`;
      }
      const nickname = nicknames[username] || null;
      return {
        username,
        nickname,
        headImageUrl
      };
    }));
    
    res.json({
      online: true,
      playersOnline: statusData.players.online,
      players: playersData
    });
  } catch (err) {
    console.error("서버 상태를 가져오는 중 오류:", err);
    res.status(500).json({ error: "서버 상태를 가져오는 중 오류 발생" });
  }
});

// --------------------
// 루트 경로('/')에서 HTML 페이지 제공 (자동 새로고침, 60초 간격)
// --------------------
app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.send(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Minecraft 서버 접속 플레이어 확인</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      text-align: center;
      margin-top: 50px;
      transition: background-color 0.3s, color 0.3s;
    }
    #status {
      margin-top: 20px;
      font-size: 18px;
    }
    ul {
      list-style-type: none;
      padding: 0;
    }
    li {
      font-size: 16px;
      margin-top: 5px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    img {
      width: 32px;
      height: 32px;
      margin-right: 10px;
    }
    /* 기본 테마 */
    body {
      background-color: #ffffff;
      color: #000000;
    }
    /* 다크 모드 */
    @media (prefers-color-scheme: dark) {
      body {
        background-color: #121212;
        color: #ffffff;
      }
    }
  </style>
</head>
<body>
  <h1>Minecraft 서버 접속 플레이어 확인</h1>
  <div id="status">서버 상태를 확인 중입니다...</div>
  <ul id="playerList"></ul>
  <script>
    async function loadStatus() {
      const statusElement = document.getElementById('status');
      const playerList = document.getElementById('playerList');
      statusElement.innerText = "서버 상태를 확인 중입니다...";
      playerList.innerHTML = "";
      try {
        const response = await fetch('/status', { cache: "no-store" });
        const data = await response.json();
        if (!data.online) {
          statusElement.innerText = "서버가 오프라인입니다.";
          return;
        }
        statusElement.innerText = \`서버가 온라인입니다! 현재 접속자 수: \${data.playersOnline}\`;
        data.players.forEach(player => {
          const li = document.createElement('li');
          const img = document.createElement('img');
          img.src = player.headImageUrl;
          img.alt = player.username;
          li.appendChild(img);
          let displayName = player.username;
          if (player.nickname) {
            displayName = \`\${player.nickname} (\${player.username})\`;
          }
          li.appendChild(document.createTextNode(displayName));
          playerList.appendChild(li);
        });
      } catch (err) {
        console.error(err);
        statusElement.innerText = "서버 상태를 불러오는 중 오류가 발생했습니다.";
      }
    }
    document.addEventListener("DOMContentLoaded", () => {
      loadStatus();
      setInterval(loadStatus, 60000); // 60초마다 자동 새로고침
    });
  </script>
</body>
</html>`);
});

// --------------------
// 서버 실행
// --------------------
app.listen(port, () => {
  console.log(`서버가 http://localhost:${port} 에서 실행 중입니다.`);
});