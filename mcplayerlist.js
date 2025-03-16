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

// 커맨드라인 인수 파싱 
// 예: node mcplayerlist.js -p 3000 your.server.address [nicknames_file] --https-port 8443 --https-cert ./cert.pem --https-key ./key.pem
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

// IP 로깅 미들웨어 (프록시 뒤에 있을 경우 필요 시 app.set('trust proxy', true) 추가)
app.use((req, res, next) => {
  const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  console.log(`Request from IP: ${clientIp}`);
  next();
});

// --------------------
// 닉네임 파일 로드 및 업데이트 (파일 형식: { "uuid": { "name": "실제이름", "nick": "닉네임" }, ... } )
// --------------------
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

app.get('/status', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    // mcsrvstat.us API로 서버 상태와 플레이어 이름 목록을 가져옵니다.
    const statusResponse = await fetch(`https://api.mcsrvstat.us/2/${serverIp}`);
    const statusData = await statusResponse.json();

    if (!statusData.online) {
      return res.json({ online: false, message: "서버 오프라인" });
    }

    const players = statusData.players.list || [];

    const playersData = await Promise.all(players.map(async playerName => {
      let foundUuid = null;
      let foundData = null;
      // 우선 닉네임 파일에서 UUID와 플레이어 정보를 찾습니다.
      for (const uuid in nicknames) {
        if (nicknames[uuid].name === playerName) {
          foundUuid = uuid;
          foundData = nicknames[uuid];
          break;
        }
      }
      // 파일에 정보가 없으면 API를 통해 데이터를 가져옵니다.
      if (!foundUuid) {
        console.log(`File lookup miss for ${playerName}. Using API...`);
        try {
          const response = await fetch(`https://api.ashcon.app/mojang/v2/user/${playerName}`);
          const apiData = await response.json();
          foundUuid = apiData.uuid;
          // API에서는 닉네임 정보는 제공되지 않으므로, only 실제 이름을 사용합니다.
          foundData = { name: apiData.username };
          console.log(`API loaded data for ${playerName} (UUID: ${foundUuid})`);
        } catch (err) {
          console.error(`Couldn't load data for ${playerName}`);
        }
      }
      let headImageUrl = "";
      if (foundUuid) {
        headImageUrl = `https://crafatar.com/avatars/${foundUuid}?size=32&overlay`;
      }
      // 최종 플레이어 이름: 파일 정보가 있다면 "nick (name)" 형식, 없으면 단순히 이름(또는 playerName)
      const displayName = foundData && foundData.nick ? `${foundData.nick} (${foundData.name})` : (foundData ? foundData.name : playerName);
      return {
        uuid: foundUuid,
        username: displayName,
        headImageUrl: headImageUrl
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
  res.sendFile(path.join(__dirname, 'index.html'));
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