# 端到端测试（CDP 驱动）

通过 Chrome DevTools 协议驱动真实运行的应用，覆盖导入、播放控制、四种模式、歌单、
搜索、歌词、主题、迷你模式、在线播放、持久化与重启恢复等全部主流程。

依赖：Node ≥ 22（内置 WebSocket）、ffmpeg（生成音频夹具）。测试会**清空开发环境的
userData**（`bethel-church-audio-player` 目录），勿在有真实数据的环境运行。

```bash
# 1. 生成测试音频
./tests/e2e/gen-fixtures.sh /tmp/player-fixtures

# 2. 清空开发数据并以调试端口启动应用
rm -rf "$HOME/Library/Application Support/bethel-church-audio-player"   # Windows: %APPDATA%
npm run dev -- -- --remote-debugging-port=9222 &

# 3. 阶段一：全功能流程（约 40 秒）
MUSIC_DIR=/tmp/player-fixtures node tests/e2e/driver.mjs 1

# 4. 重启应用后跑阶段二：持久化恢复 + 关闭驻留托盘
#   （杀掉应用进程，重复第 2 步，再执行）
MUSIC_DIR=/tmp/player-fixtures node tests/e2e/driver.mjs 2
```

测试钩子 `window.__test`（stores 与 audio 单例）仅在 `import.meta.env.DEV` 下暴露，
生产构建不包含。

无法自动化、需人工验证的项：托盘图标交互、系统媒体键、原生文件选择框导入、
拖文件入窗口导入、窗口拖动/迷你条拖动手感、YouTube 登录与 Premium 免广告效果。
