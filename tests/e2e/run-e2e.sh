#!/bin/bash
# macOS/Linux 全流程 e2e 测试编排：三阶段（全功能 → 重启恢复 → 坏文件恢复）
# 用法：./tests/e2e/run-e2e.sh
# 注意：会清空开发数据目录，并结束本项目的 electron 进程
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [ "$(uname)" = "Darwin" ]; then
  USERDATA="$HOME/Library/Application Support/bethel-church-audio-player"
else
  USERDATA="$HOME/.config/bethel-church-audio-player"
fi
cd "$ROOT"

stop_app() {
  pkill -f "windows-player/node_modules" 2>/dev/null || true
  sleep 3
}

start_app() {
  (npm run dev -- -- --remote-debugging-port=9222 >/tmp/player-e2e-dev.log 2>&1 &)
  for _ in $(seq 1 30); do
    sleep 2
    if curl -s -m 2 http://127.0.0.1:9222/json >/dev/null 2>&1; then
      return 0
    fi
  done
  echo "应用启动超时（CDP 端口未就绪）" >&2
  exit 1
}

FAILED=0

echo "=== 阶段 1/3：全功能流程 ==="
stop_app
rm -rf "$USERDATA"
start_app
node tests/e2e/driver.mjs 1 || FAILED=$((FAILED + 1))

echo "=== 阶段 2/3：重启恢复 + 关闭驻留托盘 ==="
stop_app
start_app
node tests/e2e/driver.mjs 2 || FAILED=$((FAILED + 1))

echo "=== 阶段 3/3：损坏 library.json 自动恢复 ==="
stop_app
echo '{corrupted!!! not json' > "$USERDATA/library.json"
start_app
node tests/e2e/driver.mjs 3 || FAILED=$((FAILED + 1))

stop_app
rm -rf "$USERDATA"

if [ "$FAILED" -eq 0 ]; then
  echo ""
  echo "全部三阶段通过 ✔"
else
  echo ""
  echo "有 $FAILED 个阶段存在失败项，请查看上方输出"
  exit 1
fi
