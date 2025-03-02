const express = require('express');
const fetch = require('node-fetch').default; // node-fetch v3 사용 (.default 추가)
const fs = require('fs');
const path = require('path');
const https = require('https');
const app = express();

// 기본 포트 및 변수 설정
let port = 3000;
let httpsPort = null;
let httpsCertPath = null;
let httpsKeyPath = null;
let serverIp = null;
let nickFilePath = null;

// 커맨드라인 인수 파싱 (예: node mcplayerlist.js -p 3000 your.server.address [nicknames_file] --https-port 8443 --https-cert ./cert.pem --https-key ./key.pem)
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '-p' || arg === '--port') {
    if (i + 1 < args.length) {
      port = parseInt(args[i + 1], 10);
      i++; // 포트 번호 건너뜁니다.
    } else {
      console.error("포트 번호가 제공되지 않았습니다. Usage: -p port");
      process.exit(1);
    }
  } else if (arg === '--https-port') {
    if (i + 1 < args.length) {
      httpsPort = parseInt(args[i + 1], 10);
      i++;
    } else {
      console.error("--https-port 옵션에는 포트 번호가 필요합니다.");
      process.exit(1);
    }
  } else if (arg === '--https-cert') {
    if (i + 1 < args.length) {
      httpsCertPath = args[i + 1];
      i++;
    } else {
      console.error("--https-cert 옵션에는 인증서 경로가 필요합니다.");
      process.exit(1);
    }
  } else if (arg === '--https-key') {
    if (i + 1 < args.length) {
      httpsKeyPath = args[i + 1];
      i++;
    } else {
      console.error("--https-key 옵션에는 키 파일 경로가 필요합니다.");
      process.exit(1);
    }
  } else if (!serverIp) {
    serverIp = arg;
  } else if (!nickFilePath) {
    nickFilePath = arg;
  }
}

if (!serverIp) {
  console.error("Usage: node mcplayerlist.js -p port your.server.address [nicknames_file] [--https-port port --https-cert cert_file --https-key key_file]");
  process.exit(1);
}

console.log(`Using port: ${port}`);
console.log(`Using Minecraft server address: ${serverIp}`);
if (httpsPort && httpsCertPath && httpsKeyPath) {
  console.log(`HTTPS 옵션 사용: 포트 ${httpsPort}, 인증서 ${httpsCertPath}, 키 ${httpsKeyPath}`);
}

// IP 로깅 미들웨어 (프록시 뒤에 있을 경우를 대비해 trust proxy 설정 필요 시 app.set('trust proxy', true) 추가)
// app.set('trust proxy', true);
app.use((req, res, next) => {
  const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  console.log(`Request from IP: ${clientIp}`);
  next();
});

// 닉네임 데이터는 기본적으로 빈 객체입니다.
let nicknames = {};

// 닉네임 파일 로드 및 업데이트 함수
function updateNicknames() {
  if (nickFilePath) {
    nickFilePath = path.isAbsolute(nickFilePath)
      ? nickFilePath
      : path.join(__dirname, nickFilePath);
    try {
      if (fs.existsSync(nickFilePath)) {
        const data = fs.readFileSync(nickFilePath, 'utf-8');
        nicknames = JSON.parse(data);
        console.log("닉네임 파일 로드 완료!");
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
}

// 초기 닉네임 로드
updateNicknames();

// 파일 변경 감지: 닉네임 파일이 지정된 경우, 60초 간격으로 파일 변경 감지하여 업데이트
if (nickFilePath) {
  fs.watchFile(nickFilePath, { interval: 60000 }, (curr, prev) => {
    if (curr.mtime > prev.mtime) {
      console.log("닉네임 파일 변경 감지 - 업데이트 수행");
      updateNicknames();
    }
  });
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
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`API 요청 실패 (${username}): ${response.status} ${response.statusText}\n${errorText}`);
          throw new Error(`API 요청 실패: ${response.statusText}`);
        }
        const data = await response.json();
        setCachedPlayer(username, data);
        console.log(`Preloaded data for ${username}`);
      } catch (err) {
        console.error(`Couldn't Preload data for ${username}`);
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
        console.log(`Cache miss for ${username}. Loading data...`);
        try {
          const response = await fetch(`https://api.ashcon.app/mojang/v2/user/${username}`);
          playerData = await response.json();
          setCachedPlayer(username, playerData);
          console.log(`Loaded data for ${username}`);
        } catch (err) {
          console.error(`Couldn't Preload data for ${username}`);
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
// 루트 경로('/')에서 HTML 파일 제공
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
// 서버 실행: HTTP 서버는 항상 실행, HTTPS 옵션이 모두 지정되면 HTTPS 서버도 실행
// --------------------
app.listen(port, () => {
  console.log(`HTTP 서버가 http://localhost:${port} 에서 실행 중입니다.`);
});

if (httpsPort && httpsCertPath && httpsKeyPath) {
  // 절대 경로 변환
  httpsCertPath = path.isAbsolute(httpsCertPath)
    ? httpsCertPath
    : path.join(__dirname, httpsCertPath);
  httpsKeyPath = path.isAbsolute(httpsKeyPath)
    ? httpsKeyPath
    : path.join(__dirname, httpsKeyPath);

  const cert = fs.readFileSync(httpsCertPath, 'utf-8');
  const key = fs.readFileSync(httpsKeyPath, 'utf-8');
  const httpsOptions = { key, cert };

  https.createServer(httpsOptions, app).listen(httpsPort, () => {
    console.log(`HTTPS 서버가 https://localhost:${httpsPort} 에서 실행 중입니다.`);
  });
}