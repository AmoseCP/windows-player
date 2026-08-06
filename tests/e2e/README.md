# 端到端测试（CDP 驱动）

通过 Chrome DevTools 协议驱动真实运行的应用，三阶段共 28 项断言：

1. **全功能流程**：导入/去重/封面、双击播放、未开播时点播放键从当前视图开播、
   Range 进度跳转、快捷键、切歌、
   四种播放模式（含自动切歌边界）、音量静音、歌单全套 CRUD/重排/级联删除、
   库删除同步队列、搜索过滤、列头排序、缺失文件容错、歌词同步高亮、主题、
   迷你模式、在线面板/webview/历史、YouTube 搜索（联网）、防抖持久化
2. **重启恢复**：音乐库/歌单树/音量/上次曲目（选中不自动播）/在线历史 + 关闭窗口停播驻留托盘
3. **坏文件恢复**：损坏 library.json 后空库启动不崩溃 + 自动备份

依赖：Node ≥ 22（内置 WebSocket）。测试音频夹具已内置在 `fixtures/`，无需 ffmpeg
（如需重新生成：`./gen-fixtures.sh fixtures`，需要 ffmpeg）。

⚠️ 测试会**清空开发环境的 userData**（`bethel-church-audio-player` 目录）并结束
electron 进程，勿在有真实数据的环境运行。

## 一条命令运行全部三阶段

```bash
# macOS / Linux
./tests/e2e/run-e2e.sh
```

```powershell
# Windows（项目根目录）
powershell -ExecutionPolicy Bypass -File tests\e2e\run-e2e.ps1
```

也可手动分阶段：启动 `npm run dev -- -- --remote-debugging-port=9222` 后执行
`node tests/e2e/driver.mjs <1|2|3>`（阶段 2 前需重启应用，阶段 3 前需写坏 library.json 再重启）。

测试钩子 `window.__test`（stores 与 audio 单例）仅在 `import.meta.env.DEV` 下暴露，
生产构建不包含。

无法自动化、需人工验证的项：托盘图标交互、系统媒体键、原生文件选择框导入、
拖文件入窗口导入、窗口拖动/迷你条拖动手感、YouTube 登录与 Premium 免广告效果。
