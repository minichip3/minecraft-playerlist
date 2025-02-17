const express = require('express');
const fetch = require('node-fetch'); // node-fetch v2 사용
const fs = require('fs');
const path = require('path');
const app = express();
const port = 3000;

// 환경 변수 SERVER를 사용하여 대상 서버 주소를 지정 (기본값 없음)
const serverIp = process.env.SERVER;
if (!serverIp) {
  console.error("SERVER 환경 변수가 설정되지 않았습니다. 예: -e SERVER=your.server.address");
  process.exit(1);
}

// 닉네임 파일은 상대경로로 ./playerlist/nicknames.json에서 로드
const nickFilePath = path.join(__dirname, 'playerlist', 'nicknames.json');

// nicknames.json 파일 캐시 및 TTL 설정 (예: 60초마다 업데이트)
let nicknames = {};
let lastNicknamesUpdate = 0;
const NICKNAMES_TTL = 60 * 1000; // 60초

function updateNicknames() {
  try {
    if (fs.existsSync(nickFilePath)) {
      const data = fs.readFileSync(nickFilePath, 'utf-8');
      nicknames = JSON.parse(data);
      console.log("닉네임 데이터 업데이트 완료:", nicknames);
    } else {
      console.warn(`경고: 닉네임 파일이 존재하지 않습니다 (${nickFilePath}). 빈 닉네임 데이터로 진행합니다.`);
      nicknames = {};
    }
  } catch (err) {
    console.error("nicknames.json 파일 업데이트 실패:", err);
    nicknames = {};
  }
  lastNicknamesUpdate = Date.now();
}

// 초기 닉네임 로드
updateNicknames();

// 플레이어 데이터 캐시 (메모리 내, TTL: 10분)
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

// /status 엔드포인트: 서버 상태 및 플레이어 목록 집계
app.get('/status', async (req, res) => {
  // 브라우저 캐시를 방지하기 위해 캐시 제어 헤더 설정
  res.set('Cache-Control', 'no-store');

  try {
    // 닉네임 데이터 업데이트: TTL이 지나면 파일을 다시 읽음
    if (Date.now() - lastNicknamesUpdate > NICKNAMES_TTL) {
      updateNicknames();
    }
    
    // mcsrvstat.us API로 서버 상태 가져오기
    const statusResponse = await fetch(`https://api.mcsrvstat.us/2/${serverIp}`);
    const statusData = await statusResponse.json();

    if (!statusData.online) {
      return res.json({ online: false, message: "서버 오프라인" });
    }

    // 플레이어 목록 (없으면 빈 배열)
    const players = statusData.players.list || [];

    // 각 플레이어에 대해 캐시 또는 Ashcon API로 데이터 가져오기
    const playersData = await Promise.all(players.map(async username => {
      let playerData = getCachedPlayer(username);
      if (!playerData) {
        try {
          const response = await fetch(`https://api.ashcon.app/mojang/v2/user/${username}`);
          playerData = await response.json();
          setCachedPlayer(username, playerData);
        } catch (err) {
          console.error("플레이어 데이터 로드 오류:", username, err);
          playerData = null;
        }
      }
      // 플레이어 데이터가 있으면 Crafatar API로 얼굴 이미지 URL 생성 (32x32)  
      // 캐시 배스팅: ts 쿼리 파라미터로 서버 타임스탬프 추가
      let headImageUrl = "";
      if (playerData && playerData.uuid) {
        headImageUrl = `https://crafatar.com/avatars/${playerData.uuid}?size=32&overlay&ts=${playerCache[username] ? playerCache[username].timestamp : Date.now()}`;
      }
      // 닉네임 파일에 정의된 닉네임 확인
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

// 루트 경로('/')에서 HTML 페이지 제공 (자동 새로고침, 60초 간격)
app.get('/', (req, res) => {
  // HTML 응답에도 캐시 방지 헤더 설정
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

// 서버 실행
app.listen(port, () => {
  console.log(`서버가 http://localhost:${port} 에서 실행 중입니다.`);
});
