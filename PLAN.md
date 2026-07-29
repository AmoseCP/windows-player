# Windows 音乐播放器 — 开发计划

> 依据 `PROMPT.md` 的完整需求制定。遵循 CLAUDE.md 准则：每一步有明确的验证标准，只实现需求中列出的功能，不做投机性设计。

---

## 0. 前置假设与决策（CLAUDE.md §1：先声明假设）

| # | 假设 / 决策 | 理由 |
|---|------------|------|
| A1 | 开发机为 macOS，目标平台为 Windows 10/11 | 当前环境是 Darwin。开发/自测在 macOS 进行（Electron 跨平台），NSIS/便携版打包配置按 Windows 编写，最终产物需在 Windows 机器上验证 |
| A2 | 脚手架采用 **electron-vite**（electron + react 模板） | 需求指定 Electron + React + Vite；electron-vite 是该组合的主流方案，主/渲染/preload 三进程构建开箱即用，避免手工拼装 |
| A3 | 状态管理用 **zustand** | 需求未指定；全局状态（音乐库、歌单树、播放队列、设置）跨多个组件共享，zustand 轻量且无样板代码。不引入 Redux 等重方案 |
| A4 | 样式用**纯 CSS（CSS 变量 + 少量模块化文件）** | 需求只要"深色主题、现代简洁"，不需要主题切换等配置能力，不引入 Tailwind/UI 库，保持最小依赖 |
| A5 | 封面缓存为 `userData/covers/<hash>.jpg` 文件，JSON 只存文件名 | 需求第五节明确要求大图不进 JSON |
| A6 | 元数据解析在**主进程**逐批进行，通过 IPC 回传进度 | 需求第六节要求文件系统/解析放主进程；分批（每批 ~10 首）避免 UI 卡死 |
| A7 | 渲染进程播放本地文件采用 **自定义协议 `localfile://`**（`protocol.handle` 注册，流式读取） | contextIsolation 开启后渲染进程无法用 `file://` 直接读任意路径；自定义协议由主进程控制、支持 Range 请求（进度拖动必需），比读全量 Buffer 更省内存 |
| A8 | 多选整体拖动（加分项）**先不做**，单曲拖动必做；系统媒体键（加分项）用 Electron `globalShortcut` 的 MediaKey 实现，放在最后一步，失败不阻塞验收 | 需求明确标注为加分项，按"最小实现"原则排后 |
| A9 | TypeScript | electron-vite 模板默认，类型对 IPC 契约和数据结构有实际收益 |

如与预期不符（例如必须在 Windows 上开发、要求 JS 而非 TS），请指出，其余按本计划执行。

---

## 1. 技术栈与依赖清单

**运行时依赖**
- `electron`（框架）
- `react` / `react-dom`
- `music-metadata` — 元数据 + 内嵌封面解析（主进程使用）
- `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/modifiers` — 拖拽排序
- `zustand` — 渲染进程状态
- ID 生成用 Node 内置 `crypto.randomUUID()`（少一个依赖）

**开发依赖**
- `electron-vite`、`vite`、`typescript`
- `electron-builder` — NSIS 安装包 + portable exe

---

## 2. 项目结构

```
windows-player/
├── electron.vite.config.ts
├── electron-builder.yml
├── package.json
├── src/
│   ├── main/                    # 主进程
│   │   ├── index.ts             # 窗口创建、协议注册、应用生命周期
│   │   ├── ipc.ts               # 所有 ipcMain handler 集中注册
│   │   ├── library.ts           # 导入：目录递归扫描、格式过滤、去重
│   │   ├── metadata.ts          # music-metadata 解析 + 封面提取缓存
│   │   └── store.ts             # JSON 持久化（加载/防抖保存/原子写入）
│   ├── preload/
│   │   └── index.ts             # contextBridge 暴露白名单 API
│   ├── renderer/
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx          # 布局骨架（顶部栏/侧栏/主区/播放栏）
│   │       ├── store/
│   │       │   ├── library.ts   # tracks / folders / playlists 状态与操作
│   │       │   └── player.ts    # 播放队列、当前曲目、模式、音量
│   │       ├── components/
│   │       │   ├── TopBar.tsx        # 应用名、搜索框、导入按钮
│   │       │   ├── Sidebar.tsx       # 树形侧边栏 + 右键菜单 + 拖放目标
│   │       │   ├── TrackList.tsx     # 歌曲表格（列头排序 / dnd 排序）
│   │       │   ├── PlayerBar.tsx     # 底部播放栏
│   │       │   ├── ContextMenu.tsx   # 通用右键菜单（含级联子菜单）
│   │       │   └── ConfirmDialog.tsx # 删除确认
│   │       ├── hooks/
│   │       │   ├── useAudio.ts       # <audio> 封装：播放/进度/结束切歌/错误
│   │       │   └── useHotkeys.ts     # 空格、Ctrl+←/→
│   │       └── styles/               # 深色主题 CSS 变量与组件样式
│   └── shared/
│       └── types.ts             # Track/Playlist/Folder/Settings/IPC 契约类型
├── PROMPT.md
├── PLAN.md
└── README.md
```

---

## 3. 关键设计

### 3.1 数据模型（与 PROMPT.md 第五节一致）

```ts
interface Track {
  id: string;
  path: string;
  title: string;      // 解析失败时 = 文件名（去扩展名）
  artist: string;     // 缺省 "未知艺术家"
  album: string;      // 缺省 "未知专辑"
  duration: number;   // 秒
  coverFile: string | null;  // covers/ 下的文件名
  addedAt: number;
  missing?: boolean;  // 播放时发现文件不存在则置 true 并持久化，列表标灰
}

interface PlaylistFolder { id: string; name: string; playlistIds: string[]; }
interface Playlist { id: string; name: string; trackIds: string[]; }

interface AppData {
  tracks: Record<string, Track>;
  folders: PlaylistFolder[];
  playlists: Record<string, Playlist>;
  rootPlaylistIds: string[];
  settings: {
    volume: number; muted: boolean;
    playMode: 'order' | 'loop' | 'single' | 'shuffle';
    lastPlayedTrackId: string | null;
    sidebarWidth: number;
  };
}
```

持久化：`userData/library.json`。渲染进程任何变更 → IPC `data:save`（整份 AppData）→ 主进程 500ms 防抖 → 先写临时文件再 rename（原子写，防写坏）。启动时主进程读取；解析失败则备份坏文件并以空库启动（不崩溃）。

### 3.2 IPC 契约（preload 白名单）

| 通道 | 方向 | 作用 |
|------|------|------|
| `dialog:pickFiles` / `dialog:pickFolder` | invoke | 系统选择框（按支持扩展名过滤） |
| `import:paths(paths[])` | invoke | 文件/文件夹混合列表 → 递归扫描 → 去重 → 分批解析；返回新增 Track[] |
| `import:progress` | main→renderer | `{ done, total }` 导入进度 |
| `data:load` / `data:save(appData)` | invoke / send | 持久化 |
| `track:checkExists(path)` | invoke | 播放前校验文件存在 |
| `media:key` | main→renderer | 系统媒体键事件（加分项） |

拖入窗口导入：渲染进程 drop 事件拿到 `File` 列表，用 `webUtils.getPathForFile()`（preload 暴露）取真实路径，走同一条 `import:paths` 通道（文件夹路径由主进程递归展开）。

### 3.3 播放引擎（useAudio）

- 单例 `<audio>` 元素，`src = localfile://<encoded path>`。
- MP4 用 audio 标签加载 → 天然只出声不出画（验收第 2 条）。
- `error` 事件（含 WMA 解码失败）→ 先 `track:checkExists` 区分两种情况：文件缺失 → 提示「文件不存在」并标记 `missing` 标灰；否则提示「该格式暂不支持播放」。均自动跳下一首，不崩溃。
- `ended` → 按播放模式决定下一首：
  - 顺序播放：到队列末尾即停止
  - 列表循环：末尾回到开头
  - 单曲循环：重播当前
  - 随机播放：队列内随机（避开当前曲目；「上一首」用历史栈回退）
- 双击歌曲行：以「当前视图列表（含搜索过滤后的顺序）」为播放队列，从该曲开始。

### 3.4 侧边栏树与拖拽

- 树 = 固定「音乐库」入口 + folders（可折叠）+ 根级 playlists。
- 两类拖拽用 dnd-kit 统一 DndContext，靠 drag data `type` 区分：
  1. `type: 'playlist'` → 拖到文件夹节点/根区域 = 移动歌单归属
  2. `type: 'track'`（从主区列表拖出）→ 拖到歌单节点 = 添加歌曲引用。同一首歌可加入多个歌单（需求明确）；**同一歌单内重复添加则跳过**（需求未提，按主流播放器惯例，见 PROMPT.md 末尾授权）
- 歌单内排序：`SortableContext` 垂直列表策略；拖动中行半透明（opacity 0.5）、目标位置显示插入指示线。松手 → 更新 `trackIds` 数组 → 触发防抖保存。
- 列表排序规则：音乐库默认按导入时间，支持点击列头按标题/艺术家/专辑/时长排序；歌单内**只有**手动拖拽顺序，不提供列头排序（两种排序语义互斥，避免冲突）。

---

## 4. 分步实施（CLAUDE.md §4：每步 → 验证）

按 PROMPT.md 第八节顺序执行，每步完成先验证再进入下一步。

### Step 1 — 项目骨架
- 用 electron-vite react-ts 模板初始化到当前目录；配置窗口：最小尺寸 960×640、深色背景、简体中文标题。
- 开启 `contextIsolation: true`、`nodeIntegration: false`；注册 `localfile://` 协议（先空实现）。
- 搭出四区布局骨架（TopBar / Sidebar / TrackList 占位 / PlayerBar 占位）+ 深色主题 CSS 变量；侧边栏与主区之间加可拖动分隔条。
- **验证**：`npm run dev` 窗口启动，四区布局可见，窗口可缩放且最小尺寸生效，侧栏宽度可拖。

### Step 2 — 导入 + 音乐库列表
- 主进程：`library.ts`（递归扫描、8 种扩展名过滤、按 path 去重）、`metadata.ts`（music-metadata 解析，失败回退文件名；封面提取→按内容 hash 存 `covers/`，同图复用）、分批解析（10 首/批，让出事件循环）+ 进度事件。
- 渲染进程：导入按钮（文件/文件夹两个入口）、窗口 drop 处理、进度提示「正在导入 x/y」、TrackList 展示（# / 封面 / 标题 / 艺术家 / 专辑 / 时长）、列头排序、missing 标灰样式。
- **验证**：三种方式各导入 mp3/flac/m4a/mp4，元数据与封面正确；导入 200+ 文件目录时界面不冻结、进度持续更新；重复导入同一文件被跳过；无标签文件显示文件名。

### Step 3 — 播放栏与播放控制
- `useAudio` hook + PlayerBar：封面（无封面显示占位图）/标题/艺术家、播放暂停/上一首/下一首、可点击可拖动的进度条（当前时间/总时长）、音量滑块+静音按钮、播放模式按钮（四种循环切换，图标区分）。
- 双击播放、当前播放曲目在列表中高亮、播放错误处理（WMA 提示、文件缺失标灰，见 3.3）。
- **验证**：对应验收第 2、5 条 — mp4 只出声无画面；播放/暂停/切歌/进度拖动/音量/四种模式逐一手测；删除磁盘上的源文件后播放 → 提示且标灰、不崩溃。

### Step 4 — 侧边栏树与歌单增删改
- Sidebar 树形结构（音乐库固定项 + 可折叠文件夹 + 歌单）、右键菜单（新建歌单/新建歌单文件夹/重命名/删除）、重命名用内联输入框、删除文件夹弹确认框（说明将连带删除其中歌单）、删除歌单直接确认。
- 点击节点切换主区视图（音乐库 / 某歌单）。
- **验证**：对应验收第 3、6 条（歌单/文件夹部分）— 新建、重命名、删除、折叠展开全部正常；删文件夹有确认且连带删除内部歌单。

### Step 5 — 加歌入单 + 拖拽排序
- 歌曲右键菜单：「添加到歌单」级联子菜单（按 文件夹→歌单 分组展示）、「从歌单中移除」（仅歌单视图显示）、「从音乐库删除」（确认框 + 从所有歌单清引用，不删磁盘文件）。
- dnd-kit：歌单内行拖拽排序（半透明 + 插入指示线）；歌曲拖到侧栏歌单节点 = 添加；歌单节点在文件夹之间/根级拖动移动。
- **验证**：对应验收第 4、6 条 — 右键与拖拽两种方式加歌均可；同一首歌可进多个歌单；歌单内拖动顺序立即生效；从歌单移除不影响音乐库；从音乐库删除后所有歌单中同步消失。

### Step 6 — 持久化与启动恢复
- `store.ts`：启动加载 → 注入渲染进程；所有 mutation 后触发 `data:save`（主进程 500ms 防抖 + 原子写）；`before-quit` 时强制 flush 未落盘数据。
- 恢复内容：音乐库、歌单树与歌单内顺序、音量/静音、播放模式、上次播放曲目（恢复为「已选中未播放」状态，不自动出声）、侧栏宽度。
- **验证**：对应验收第 4、7 条 — 调整歌单顺序/音量/模式后重启应用全部保持；手动写坏 library.json 后启动，应用备份坏文件并以空库正常打开，不崩溃。

### Step 7 — 搜索、快捷键、细节打磨
- 顶部搜索框：对当前视图按 标题/艺术家/专辑 实时过滤（大小写不敏感）；搜索过滤状态下禁用歌单内拖拽排序（过滤视图下排序无意义）。
- 快捷键：空格 = 播放/暂停（焦点在输入框时不触发）、Ctrl+→ = 下一首、Ctrl+← = 上一首。
- 加分项：系统媒体键（MediaPlayPause / MediaNextTrack / MediaPreviousTrack）→ 主进程转发到渲染进程；注册失败静默降级。
- 细节：音乐库为空时的引导导入空状态；列表在千首级实测流畅度，卡顿才引入轻量虚拟化（不提前优化）。
- **验证**：对应验收第 8 条 — 搜索实时过滤；三个快捷键有效且不干扰输入框输入；媒体键可用。

### Step 8 — 打包
- `electron-builder.yml`：appId、产品名、`win.target: [nsis, portable]`、NSIS 允许选择安装目录、应用图标（生成一枚简单 ico）。
- 编写 README.md：安装依赖 / `npm run dev` / `npm run build` 说明 + 产物位置 + 跨平台打包注意事项（macOS 交叉打包 Windows 的限制，建议在 Windows 上执行最终构建）。
- **验证**：`npm run build` 本机产出构建产物无报错，配置含 NSIS + portable 两个 target。⚠️ 最终 exe 的安装与运行需在 Windows 机器上终验，README 中附上 PROMPT.md 第七节的 8 条自测清单。

---

## 5. 验收对照表（PROMPT.md 第七节 → 计划步骤）

| 验收项 | 覆盖步骤 |
|-------|---------|
| 1. 按钮+拖入导入，元数据/封面正确 | Step 2 |
| 2. mp4 只出声无画面 | Step 3 |
| 3. 歌单文件夹/歌单/树折叠 | Step 4 |
| 4. 加歌、拖排、重启保持顺序 | Step 5 + 6 |
| 5. 全部播放控制与四种模式 | Step 3 |
| 6. 删除/移除/重命名（含确认） | Step 4 + 5 |
| 7. 重启全量恢复 | Step 6 |
| 8. 搜索实时过滤 | Step 7 |

---

## 6. 风险与对策

| 风险 | 对策 |
|------|------|
| macOS 上无法完整验证 Windows 行为（媒体键、NSIS、路径分隔符） | 路径统一用 Node `path` 模块处理；打包与媒体键在 README 中标注需 Windows 终验 |
| 大音乐库（数千首）列表渲染卡顿 | Step 7 实测，卡顿才引入轻量虚拟化，不提前优化 |
| dnd-kit 同页面多种拖拽语义（行排序 / 拖入侧栏 / 歌单移动） | 统一 DndContext，靠 drag data type + droppable id 前缀区分，Step 5 集中实现 |
| `music-metadata` 对损坏/异型文件抛错 | 每文件 try/catch，失败回退文件名作标题，导入不中断（需求已明确） |
| WMA 无法解码 | audio error 事件 → 友好提示「该格式暂不支持播放」→ 跳下一首（需求已明确） |
| library.json 写入中断损坏 | 临时文件 + rename 原子写；启动读取失败时备份坏文件、空库启动 |
