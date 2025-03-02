#!/bin/sh
# entrypoint.sh

# 기본 명령 구성: $SERVER와 $NICKLIST는 항상 포함
CMD="node /app/mcplayerlist.js -p ${PORT} ${SERVER} ${NICKLIST}"

# HTTPS 관련 변수들이 모두 설정되어 있으면 HTTPS 옵션을 추가
if [ -n "$HTTPSPORT" ] && [ -n "$HTTPSCERT" ] && [ -n "$HTTPSKEY" ]; then
  CMD="node /app/mcplayerlist.js -p ${PORT} --https-port ${HTTPSPORT} --https-cert ${HTTPSCERT} --https-key ${HTTPSKEY} ${SERVER} ${NICKLIST}"
fi

echo "Running command: $CMD"
exec $CMD