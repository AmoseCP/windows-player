// CDP 驱动的端到端测试：node driver.mjs <phase 1|2>
import fs from 'fs'
import path from 'path'
import os from 'os'

import { fileURLToPath } from 'url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 默认使用仓库内置夹具；路径归一为正斜杠（会嵌入页面内执行的 JS 字符串）
const MUSIC = (process.env.MUSIC_DIR ?? path.join(__dirname, 'fixtures')).replace(/\\/g, '/')
const USERDATA =
  process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library/Application Support/bethel-church-audio-player')
    : path.join(process.env.APPDATA ?? '', 'bethel-church-audio-player')
const phase = process.argv[2] ?? '1'

let ws
let msgId = 0
const pending = new Map()

async function connect() {
  const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = targets.find((t) => t.type === 'page')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => {
    ws.onopen = r
    ws.onerror = j
  })
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
  }
}

function send(method, params) {
  return new Promise((resolve) => {
    const id = ++msgId
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function ev(code, retries = 2) {
  const res = await send('Runtime.evaluate', {
    expression: '(async () => {' + code + '})()',
    awaitPromise: true,
    returnByValue: true
  })
  // CDP 偶发把 awaited promise 回收，与被测代码无关，重试即可
  if (res.error?.message?.includes('Promise was collected') && retries > 0) {
    await new Promise((r) => setTimeout(r, 500))
    return ev(code, retries - 1)
  }
  if (res.error) {
    throw new Error('CDP 错误: ' + JSON.stringify(res.error).slice(0, 300))
  }
  if (res.result?.exceptionDetails) {
    throw new Error('页面异常: ' + JSON.stringify(res.result.exceptionDetails).slice(0, 400))
  }
  return res.result?.result?.value
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
async function test(name, fn) {
  try {
    await fn()
    pass++
    console.log('PASS ' + name)
  } catch (err) {
    fail++
    console.log('FAIL ' + name + ' :: ' + err.message)
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg)
}

setTimeout(() => { console.log('GLOBAL TIMEOUT'); process.exit(2) }, 150000).unref()
await connect()

if (phase === '1') {
  await test('测试钩子可用', async () => {
    const t = await ev('return typeof window.__test')
    expect(t === 'object', '__test 未暴露: ' + t)
  })

  await test('导入文件夹（递归扫描/过滤/元数据）', async () => {
    const r = await ev(`
      await window.__test.useLibrary.getState().importPaths(['${MUSIC}'])
      const s = window.__test.useLibrary.getState()
      return { count: s.trackOrder.length, titles: s.trackOrder.map(id => s.tracks[id].title) }
    `)
    expect(r.count === 4, '应导入 4 首，实际 ' + r.count + ' ' + JSON.stringify(r.titles))
    expect(r.titles.includes('测试歌曲') && r.titles.includes('无标签'), '标题解析/回退错误: ' + JSON.stringify(r.titles))
  })

  await test('重复导入去重', async () => {
    const r = await ev(`
      await window.__test.useLibrary.getState().importPaths(['${MUSIC}'])
      return window.__test.useLibrary.getState().trackOrder.length
    `)
    expect(r === 4, '重复导入后应仍为 4，实际 ' + r)
  })

  await test('列表渲染与封面显示（localfile 协议）', async () => {
    await sleep(500)
    const r = await ev(`
      const img = document.querySelector('.track-cover img')
      return { rows: document.querySelectorAll('.track-row').length, loaded: img ? img.naturalWidth > 0 : false }
    `)
    expect(r.rows === 4, '行数 ' + r.rows)
    expect(r.loaded, '封面图未加载成功')
  })

  await test('双击播放', async () => {
    const r = await ev(`
      document.querySelectorAll('.track-row')[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      await new Promise(r => setTimeout(r, 800))
      const p = window.__test.usePlayer.getState()
      const a = window.__test.audio
      return { playing: p.playing, paused: a.paused, dur: a.duration, title: document.querySelector('.playerbar-title').textContent, highlight: !!document.querySelector('.track-row.playing') }
    `)
    expect(r.playing && !r.paused, '未开始播放 ' + JSON.stringify(r))
    expect(r.dur > 1.5 && r.dur < 3, '时长异常 ' + r.dur)
    expect(r.highlight, '当前播放行未高亮')
  })

  await test('进度跳转（Range 寻址）', async () => {
    const r = await ev(`
      const a = window.__test.audio
      a.currentTime = 1.0
      await new Promise(r => setTimeout(r, 400))
      return { t: a.currentTime, playing: !a.paused }
    `)
    expect(r.t >= 1.0 && r.playing, 'seek 后状态异常 ' + JSON.stringify(r))
  })

  await test('空格键播放/暂停', async () => {
    const r = await ev(`
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))
      await new Promise(r => setTimeout(r, 250))
      const paused1 = window.__test.audio.paused
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))
      await new Promise(r => setTimeout(r, 250))
      return { paused1, paused2: window.__test.audio.paused }
    `)
    expect(r.paused1 === true && r.paused2 === false, JSON.stringify(r))
  })

  await test('上一曲/下一曲按钮', async () => {
    const r = await ev(`
      const title = () => document.querySelector('.playerbar-title').textContent
      const before = title()
      document.querySelector('button[title="下一首"]').click()
      await new Promise(r => setTimeout(r, 500))
      const next = title()
      document.querySelector('button[title="上一首"]').click()
      await new Promise(r => setTimeout(r, 500))
      return { before, next, back: title() }
    `)
    expect(r.next !== r.before, '下一曲未切换')
    expect(r.back === r.before, '上一曲未返回')
  })

  await test('音量与静音', async () => {
    const r = await ev(`
      const p = window.__test.usePlayer.getState()
      p.setVolume(0.33); await new Promise(r => setTimeout(r, 100))
      const v = window.__test.audio.volume
      p.toggleMute(); await new Promise(r => setTimeout(r, 100))
      const muted = window.__test.audio.muted
      p.toggleMute(); await new Promise(r => setTimeout(r, 100))
      return { v, muted, unmuted: !window.__test.audio.muted }
    `)
    expect(Math.abs(r.v - 0.33) < 0.01 && r.muted && r.unmuted, JSON.stringify(r))
  })

  await test('顺序播放：自动切歌 + 末尾停止', async () => {
    const r = await ev(`
      const lib = window.__test.useLibrary.getState()
      const p = window.__test.usePlayer.getState()
      p.setPlayMode('order')
      p.startQueue(lib.trackOrder, 2)
      await new Promise(r => setTimeout(r, 700))
      const a = window.__test.audio
      a.currentTime = Math.max(0, a.duration - 0.4)
      await new Promise(r => setTimeout(r, 1600))
      const afterAuto = window.__test.usePlayer.getState().queueIndex
      a.currentTime = Math.max(0, a.duration - 0.4)
      await new Promise(r => setTimeout(r, 1600))
      const st = window.__test.usePlayer.getState()
      return { afterAuto, endIndex: st.queueIndex, endPlaying: st.playing }
    `)
    expect(r.afterAuto === 3, '自动切歌失败 ' + JSON.stringify(r))
    expect(r.endIndex === 3 && r.endPlaying === false, '末尾未停止 ' + JSON.stringify(r))
  })

  await test('列表循环 + 单曲循环', async () => {
    const r = await ev(`
      const lib = window.__test.useLibrary.getState()
      const p = window.__test.usePlayer.getState()
      p.setPlayMode('loop')
      p.startQueue(lib.trackOrder, 3)
      await new Promise(r => setTimeout(r, 700))
      const a = window.__test.audio
      a.currentTime = Math.max(0, a.duration - 0.4)
      await new Promise(r => setTimeout(r, 1600))
      const loopIndex = window.__test.usePlayer.getState().queueIndex
      window.__test.usePlayer.getState().setPlayMode('single')
      const beforeIdx = window.__test.usePlayer.getState().queueIndex
      a.currentTime = Math.max(0, a.duration - 0.4)
      await new Promise(r => setTimeout(r, 1700))
      const st = window.__test.usePlayer.getState()
      return { loopIndex, singleSame: st.queueIndex === beforeIdx, replayT: window.__test.audio.currentTime, playing: st.playing }
    `)
    expect(r.loopIndex === 0, '列表循环未回开头 ' + JSON.stringify(r))
    expect(r.singleSame && r.replayT < 1.6 && r.playing, '单曲循环异常 ' + JSON.stringify(r))
  })

  await test('随机播放与历史回退', async () => {
    const r = await ev(`
      const lib = window.__test.useLibrary.getState()
      const p = window.__test.usePlayer.getState()
      p.setPlayMode('shuffle')
      p.startQueue(lib.trackOrder, 0)
      await new Promise(r => setTimeout(r, 300))
      p.next(false); await new Promise(r => setTimeout(r, 300))
      const moved = window.__test.usePlayer.getState().queueIndex
      p.prev(); await new Promise(r => setTimeout(r, 300))
      const back = window.__test.usePlayer.getState().queueIndex
      p.setPlayMode('order')
      return { moved, back }
    `)
    expect(r.moved !== 0, '随机未切换')
    expect(r.back === 0, '历史回退失败 ' + JSON.stringify(r))
  })

  await test('歌单：建/改/加歌/去重/重排/移除/移动', async () => {
    const r = await ev(`
      const lib = () => window.__test.useLibrary.getState()
      const fid = lib().createFolder()
      const pid = lib().createPlaylist(fid)
      lib().renameFolder(fid, '测试文件夹')
      lib().renamePlaylist(pid, '我的歌单')
      const ids = lib().trackOrder
      const add1 = lib().addTrackToPlaylist(pid, ids[0])
      const dup = lib().addTrackToPlaylist(pid, ids[0])
      const add2 = lib().addTrackToPlaylist(pid, ids[1])
      lib().setView(pid)
      await new Promise(r => setTimeout(r, 300))
      const rows = document.querySelectorAll('.track-row').length
      const names = [...document.querySelectorAll('.sidebar-item')].map(n => n.textContent)
      lib().reorderPlaylist(pid, ids[0], ids[1])
      const reordered = lib().playlists[pid].trackIds[0] === ids[1]
      lib().removeTrackFromPlaylist(pid, ids[0])
      const afterRemove = lib().playlists[pid].trackIds.length
      lib().movePlaylist(pid, null)
      const inRoot = lib().rootPlaylistIds.includes(pid)
      lib().movePlaylist(pid, fid)
      const backInFolder = lib().folders.find(f => f.id === fid).playlistIds.includes(pid)
      return { add1, dup, add2, rows, hasF: names.some(t => t.includes('测试文件夹')), hasP: names.some(t => t.includes('我的歌单')), reordered, afterRemove, inRoot, backInFolder }
    `)
    expect(r.add1 === true && r.dup === false && r.add2 === true, '加歌/去重: ' + JSON.stringify(r))
    expect(r.rows === 2, '歌单视图行数 ' + r.rows)
    expect(r.hasF && r.hasP, '侧栏未显示节点')
    expect(r.reordered, '重排失败')
    expect(r.afterRemove === 1, '移除失败')
    expect(r.inRoot && r.backInFolder, '歌单移动失败 ' + JSON.stringify(r))
  })

  await test('删除歌单/删除文件夹连带', async () => {
    const r = await ev(`
      const lib = () => window.__test.useLibrary.getState()
      const pid3 = lib().createPlaylist(null)
      lib().deletePlaylist(pid3)
      const rootGone = !lib().rootPlaylistIds.includes(pid3) && !lib().playlists[pid3]
      const fid2 = lib().createFolder()
      const pid2 = lib().createPlaylist(fid2)
      lib().setView(pid2)
      lib().deleteFolder(fid2)
      const s = lib()
      return { rootGone, cascaded: !s.playlists[pid2], folderGone: !s.folders.find(f => f.id === fid2), viewReset: s.view === 'library' }
    `)
    expect(r.rootGone && r.cascaded && r.folderGone && r.viewReset, JSON.stringify(r))
  })

  await test('从音乐库删除（清歌单引用+队列同步）', async () => {
    const r = await ev(`
      const lib = () => window.__test.useLibrary.getState()
      const ids = lib().trackOrder
      const pl = lib().folders.find(f => f.name === '测试文件夹').playlistIds[0]
      lib().addTrackToPlaylist(pl, ids[2])
      window.__test.usePlayer.getState().startQueue(ids, 2)
      await new Promise(r => setTimeout(r, 400))
      lib().deleteTrackFromLibrary(ids[2])
      window.__test.usePlayer.getState().removeFromQueue(ids[2])
      await new Promise(r => setTimeout(r, 400))
      const s = lib()
      const p = window.__test.usePlayer.getState()
      return { gone: !s.tracks[ids[2]], refCleared: !s.playlists[pl].trackIds.includes(ids[2]), count: s.trackOrder.length, queueOk: !p.queue.includes(ids[2]) }
    `)
    expect(r.gone && r.refCleared && r.count === 3 && r.queueOk, JSON.stringify(r))
  })

  await test('搜索实时过滤', async () => {
    const r = await ev(`
      const lib = () => window.__test.useLibrary.getState()
      lib().setView('library')
      lib().setSearch('无标签')
      await new Promise(r => setTimeout(r, 300))
      const one = document.querySelectorAll('.track-row').length
      lib().setSearch('不存在的关键词xyz')
      await new Promise(r => setTimeout(r, 300))
      const zero = document.querySelectorAll('.track-row').length
      const emptyHint = !!document.querySelector('.empty-state')
      lib().setSearch('')
      await new Promise(r => setTimeout(r, 300))
      return { one, zero, emptyHint, all: document.querySelectorAll('.track-row').length }
    `)
    expect(r.one === 1 && r.zero === 0 && r.emptyHint && r.all === 3, JSON.stringify(r))
  })

  await test('列头排序', async () => {
    const r = await ev(`
      const first = () => document.querySelector('.track-title').textContent
      document.querySelectorAll('.tracklist-sortable')[3].click()
      await new Promise(r => setTimeout(r, 200))
      const ascFirst = first()
      const ascArrow = !!document.querySelector('.sort-arrow')
      document.querySelectorAll('.tracklist-sortable')[3].click()
      await new Promise(r => setTimeout(r, 200))
      const descFirst = first()
      return { ascFirst, descFirst, ascArrow }
    `)
    expect(r.ascArrow, '排序指示未显示')
  })

  await test('缺失文件：提示+标灰+不崩溃', async () => {
    const missingFile = path.join(os.tmpdir(), 'missing-case.flac').replace(/\\/g, '/')
    fs.copyFileSync(path.join(MUSIC, 'sub/test3.flac'), missingFile)
    await ev(`await window.__test.useLibrary.getState().importPaths(['${missingFile}'])`)
    fs.rmSync(missingFile)
    const r = await ev(`
      const lib = () => window.__test.useLibrary.getState()
      const id = lib().trackOrder.find(i => lib().tracks[i].title === 'missing-case')
      const rows = [...document.querySelectorAll('.track-row')]
      const row = rows.find(el => el.querySelector('.track-title').textContent === 'missing-case')
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      await new Promise(r => setTimeout(r, 1200))
      const notice = window.__test.usePlayer.getState().notice
      const missing = lib().tracks[id].missing === true
      const grayed = !!document.querySelector('.track-row.missing')
      lib().deleteTrackFromLibrary(id)
      window.__test.usePlayer.getState().removeFromQueue(id)
      return { notice, missing, grayed }
    `)
    expect(r.missing && r.grayed, '未标记缺失 ' + JSON.stringify(r))
    expect(r.notice && r.notice.includes('文件不存在'), '提示错误: ' + r.notice)
  })

  await test('歌词面板（lrc 加载+同步高亮）', async () => {
    const r = await ev(`
      const lib = () => window.__test.useLibrary.getState()
      const id = lib().trackOrder.find(i => lib().tracks[i].path.endsWith('test1.mp3'))
      window.__test.usePlayer.getState().startQueue([id], 0)
      await new Promise(r => setTimeout(r, 600))
      window.__test.usePlayer.getState().toggleLyrics()
      await new Promise(r => setTimeout(r, 900))
      const lines = document.querySelectorAll('.lyrics-line').length
      window.__test.audio.pause()
      window.__test.audio.currentTime = 1.1
      await new Promise(r => setTimeout(r, 800))
      const active = [...document.querySelectorAll('.lyrics-line')].findIndex(l => l.classList.contains('active'))
      window.__test.usePlayer.getState().toggleLyrics()
      return { lines, active }
    `)
    expect(r.lines === 3, '歌词行数 ' + r.lines)
    expect(r.active === 1, '当前行高亮位置 ' + r.active)
  })

  await test('主题背景应用与还原', async () => {
    const r = await ev(`
      const lib = () => window.__test.useLibrary.getState()
      lib().setThemeImage('${MUSIC}/cover.png')
      await new Promise(r => setTimeout(r, 300))
      const themed = !!document.querySelector('.app.themed')
      const bg = document.querySelector('.app').style.backgroundImage.includes('localfile')
      lib().setThemeImage(null)
      await new Promise(r => setTimeout(r, 200))
      return { themed, bg, cleared: !document.querySelector('.app.themed') }
    `)
    expect(r.themed && r.bg && r.cleared, JSON.stringify(r))
  })

  await test('迷你模式（窗口缩放+控制可用+恢复）', async () => {
    const r = await ev(`
      const p = () => window.__test.usePlayer.getState()
      const lib = window.__test.useLibrary.getState()
      p().startQueue(lib.trackOrder, 0)
      await new Promise(r => setTimeout(r, 500))
      p().setMini(true)
      await new Promise(r => setTimeout(r, 900))
      const w = window.innerWidth
      const mini = !!document.querySelector('.mini-player')
      document.querySelector('.mini-player button[title="播放/暂停"]').click()
      await new Promise(r => setTimeout(r, 300))
      const pausedByMini = window.__test.audio.paused
      p().setMini(false)
      await new Promise(r => setTimeout(r, 900))
      return { w, mini, pausedByMini, restoredW: window.innerWidth, playerbar: !!document.querySelector('.playerbar') }
    `)
    expect(r.mini && r.w <= 320, '迷你窗口未生效 w=' + r.w)
    expect(r.pausedByMini, '迷你控制无效')
    expect(r.restoredW >= 960 && r.playerbar, '恢复失败 ' + JSON.stringify(r))
  })

  await test('在线面板 + 历史记录双击 + webview', async () => {
    await ev(`window.__test.usePlayer.getState().toggleOnline()`)
    await sleep(400)
    const panel = await ev(`return !!document.querySelector('.online-panel')`)
    expect(panel, '在线面板未打开')
    await ev(`window.__test.useLibrary.getState().addYouTubeHistory({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', videoId: 'dQw4w9WgXcQ', listId: null, title: '测试视频' })`)
    let hasItem = false
    for (let i = 0; i < 10 && !hasItem; i++) {
      await sleep(300)
      hasItem = await ev(`return [...document.querySelectorAll('.online-history-item')].some(n => n.textContent.includes('视频') || n.textContent.includes('dQw4w9WgXcQ'))`)
    }
    expect(hasItem, '历史记录未渲染')
    await ev(`
      const item = [...document.querySelectorAll('.online-history-item')][0]
      item.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    `)
    let src = null
    for (let i = 0; i < 10 && !src; i++) {
      await sleep(400)
      src = await ev(`const w = document.querySelector('webview.online-frame'); return w ? w.getAttribute('src') : null`)
    }
    expect(src && src.includes('watch?v=dQw4w9WgXcQ'), 'webview 未加载: ' + src)
    const localPaused = await ev(`return window.__test.usePlayer.getState().playing === false`)
    expect(localPaused, '在线播放未暂停本地')
    // 静音同步到 webview
    await ev(`window.__test.usePlayer.getState().toggleMute()`)
    await sleep(500)
    const wvMuted = await ev(
      `const w = document.querySelector('webview'); return w && w.isAudioMuted ? w.isAudioMuted() : null`
    )
    expect(wvMuted === true, '静音未同步到在线标签: ' + wvMuted)
    await ev(`window.__test.usePlayer.getState().toggleMute()`)
    const hidden = await ev(
      `return !document.querySelector('.playerbar button[title="播放/暂停"]') && !!document.querySelector('.playerbar-online-hint')`
    )
    expect(hidden, '在线播放时本地播放控制未隐藏')
    await ev(`window.__test.usePlayer.getState().toggleOnline()`)
    await sleep(300)
    const restored = await ev(`return !!document.querySelector('.playerbar button[title="播放/暂停"]')`)
    expect(restored, '关闭在线面板后本地控制未恢复')
  })

  await test('YouTube 搜索（网络）', async () => {
    const r = await ev(`
      const results = await window.api.searchYouTube('赞美之泉')
      return { n: results.length, hasTitle: !!results[0]?.title }
    `)
    expect(r.n > 0 && r.hasTitle, '搜索无结果 ' + JSON.stringify(r))
  })

  await test('新功能：队列/速度/淡入淡出/定时器/多选/编辑', async () => {
    const r = await ev(`
      const lib = () => window.__test.useLibrary.getState()
      const p = () => window.__test.usePlayer.getState()
      lib().setView('library')
      await new Promise(r => setTimeout(r, 200))
      // 队列面板
      p().startQueue(lib().trackOrder, 0)
      p().toggleQueue()
      await new Promise(r => setTimeout(r, 400))
      const queueItems = document.querySelectorAll('.queue-item').length
      const queueMarked = !!document.querySelector('.queue-item.playing')
      p().toggleQueue()
      // 播放速度（含越界钳制）
      p().setPlaybackRate(1.5)
      await new Promise(r => setTimeout(r, 200))
      const rateApplied = window.__test.audio.playbackRate
      p().setPlaybackRate(9)
      const rateClamped = p().playbackRate
      p().setPlaybackRate(1)
      // 淡入淡出设置
      p().setFadeSeconds(2)
      const fade = p().fadeSeconds
      p().setFadeSeconds(0)
      // 睡眠定时器
      p().setSleepTimer(30)
      const sleepSet = p().sleepAt !== null
      p().setSleepAfterTrack(true)
      const afterTrack = p().sleepAfterTrack
      p().setSleepTimer(null)
      const sleepCleared = p().sleepAt === null && !p().sleepAfterTrack
      // 多选：Shift 范围选 + Ctrl 加选
      const rows = document.querySelectorAll('.track-row')
      rows[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      await new Promise(r => setTimeout(r, 120))
      rows[2].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, shiftKey: true }))
      await new Promise(r => setTimeout(r, 200))
      const range = lib().selectedTrackIds.size
      const highlighted = document.querySelectorAll('.track-row.selected').length
      // 批量加入歌单
      const pid = lib().createPlaylist(null)
      const batchAdded = lib().addTracksToPlaylist(pid, [...lib().selectedTrackIds])
      lib().deletePlaylist(pid)
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await new Promise(r => setTimeout(r, 150))
      const escCleared = lib().selectedTrackIds.size === 0
      // 编辑歌曲信息（空白应被忽略）
      const tid = lib().trackOrder[0]
      const originalTitle = lib().tracks[tid].title
      lib().updateTrack(tid, { title: '编辑后标题' })
      const edited = lib().tracks[tid].title === '编辑后标题'
      lib().updateTrack(tid, { title: '   ' })
      const blankIgnored = lib().tracks[tid].title === '编辑后标题'
      lib().updateTrack(tid, { title: originalTitle })
      return { queueItems, queueMarked, rateApplied, rateClamped, fade, sleepSet, afterTrack,
               sleepCleared, range, highlighted, batchAdded, escCleared, edited, blankIgnored }
    `)
    expect(r.queueItems === 3 && r.queueMarked, '队列面板异常: ' + JSON.stringify(r))
    expect(r.rateApplied === 1.5 && r.rateClamped === 2, '播放速度异常: ' + JSON.stringify(r))
    expect(r.fade === 2, '淡入淡出设置未生效')
    expect(r.sleepSet && r.afterTrack && r.sleepCleared, '睡眠定时器异常: ' + JSON.stringify(r))
    expect(r.range === 3 && r.highlighted === 3, 'Shift 范围选异常: ' + r.range)
    expect(r.batchAdded === 3, '批量加入歌单异常: ' + r.batchAdded)
    expect(r.escCleared, 'Esc 未清空选区')
    expect(r.edited && r.blankIgnored, '歌曲信息编辑异常: ' + JSON.stringify(r))
  })

  await test('音乐文件夹：扫描/目录树/筛选/重匹配/不复活', async () => {
    const root = path.join(os.tmpdir(), 'bcap-scan-test')
    fs.rmSync(root, { recursive: true, force: true })
    fs.mkdirSync(path.join(root, 'A'), { recursive: true })
    fs.mkdirSync(path.join(root, 'B'), { recursive: true })
    // 用夹具音频造出目录结构（内容不同以便按大小区分）
    fs.copyFileSync(path.join(MUSIC, 'test1.mp3'), path.join(root, 'A', 'a1.mp3'))
    fs.copyFileSync(path.join(MUSIC, 'test-cover.mp3'), path.join(root, 'A', 'a2.mp3'))
    fs.copyFileSync(path.join(MUSIC, 'sub/test3.flac'), path.join(root, 'B', 'b1.flac'))
    fs.writeFileSync(path.join(root, 'note.txt'), 'not audio')
    const rootJs = root.replace(/\\/g, '/')

    const first = await ev(`
      const lib = () => window.__test.useLibrary.getState()
      const before = { tracks: lib().tracks, trackOrder: lib().trackOrder }
      window.__scanBackup = before
      window.__test.useLibrary.setState({ tracks: {}, trackOrder: [], musicFolders: ['${rootJs}'], ignoredPaths: [] })
      await lib().rescanMusicFolders(true)
      const { buildFolderTree } = await import('/src/folderTree.ts')
      const tree = buildFolderTree(Object.values(lib().tracks))
      const childNames = tree[0] ? tree[0].children.map(c => c.name).sort() : []
      lib().setView('folder:${rootJs}/A')
      await new Promise(r => setTimeout(r, 350))
      const subRows = document.querySelectorAll('.track-row').length
      lib().setView('library')
      return { count: lib().trackOrder.length, childNames, subRows }
    `)
    expect(first.count === 3, '扫描应入库 3 首（跳过 txt），实际 ' + first.count)
    expect(JSON.stringify(first.childNames) === '["A","B"]', '目录树子节点异常: ' + JSON.stringify(first.childNames))
    expect(first.subRows === 2, '目录筛选行数应为 2，实际 ' + first.subRows)

    // 磁盘上移动+改名一个文件，删除另一个，新增一个
    fs.mkdirSync(path.join(root, 'C'), { recursive: true })
    fs.renameSync(path.join(root, 'A', 'a1.mp3'), path.join(root, 'C', 'renamed.mp3'))
    fs.rmSync(path.join(root, 'B', 'b1.flac'))
    fs.copyFileSync(path.join(MUSIC, 'sub/无标签.m4a'), path.join(root, 'B', 'new.m4a'))

    const second = await ev(`
      const lib = () => window.__test.useLibrary.getState()
      const movedId = lib().trackOrder.find(i => lib().tracks[i].path.endsWith('a1.mp3'))
      const pid = lib().createPlaylist(null)
      lib().addTrackToPlaylist(pid, movedId)
      await lib().rescanMusicFolders(true)
      const moved = lib().tracks[movedId]
      const gone = Object.values(lib().tracks).find(t => t.path.endsWith('b1.flac'))
      window.__scanPid = pid
      return {
        relocated: !!moved && moved.path.endsWith('C/renamed.mp3'),
        notMissing: moved ? moved.missing !== true : false,
        playlistIntact: lib().playlists[pid].trackIds.includes(movedId),
        deletedMarked: gone ? gone.missing === true : false,
        addedNew: Object.values(lib().tracks).some(t => t.path.endsWith('new.m4a'))
      }
    `)
    expect(second.relocated && second.notMissing, '移动+改名未重新匹配: ' + JSON.stringify(second))
    expect(second.playlistIntact, '重匹配后歌单引用断链')
    expect(second.deletedMarked, '真删除的文件未标记缺失')
    expect(second.addedNew, '新增文件未入库')

    const third = await ev(`
      const lib = () => window.__test.useLibrary.getState()
      const id = lib().trackOrder.find(i => lib().tracks[i].path.endsWith('new.m4a'))
      lib().deleteTrackFromLibrary(id)
      await lib().rescanMusicFolders(true)
      const back = Object.values(lib().tracks).some(t => t.path.endsWith('new.m4a'))
      // 还原现场，避免影响后续阶段
      lib().deletePlaylist(window.__scanPid)
      window.__test.useLibrary.setState({
        tracks: window.__scanBackup.tracks,
        trackOrder: window.__scanBackup.trackOrder,
        musicFolders: [], ignoredPaths: []
      })
      return { resurrected: back, restored: lib().trackOrder.length }
    `)
    expect(!third.resurrected, '手动删除的文件在重扫后复活了')
    expect(third.restored === 3, '未还原音乐库，残留 ' + third.restored)
    fs.rmSync(root, { recursive: true, force: true })
  })

  await test('大库性能：虚拟滚动生效', async () => {
    const r = await ev(`
      const before = {
        tracks: window.__test.useLibrary.getState().tracks,
        trackOrder: window.__test.useLibrary.getState().trackOrder
      }
      const N = 3000
      const tracks = {}, order = []
      for (let i = 0; i < N; i++) {
        const id = 'perf-' + i
        tracks[id] = { id, path: '/perf/' + i + '.mp3', title: '曲目 ' + i, artist: 'A' + (i % 40), album: 'B' + (i % 90), duration: 200, coverFile: null, addedAt: i }
        order.push(id)
      }
      const t0 = performance.now()
      window.__test.useLibrary.setState({ tracks, trackOrder: order, view: 'library' })
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      const renderMs = performance.now() - t0
      const rows = document.querySelectorAll('.track-row').length
      const t1 = performance.now()
      for (let i = 0; i < 20; i++) window.__test.useLibrary.getState().setSidebarWidth(200 + i)
      const mutateMs = (performance.now() - t1) / 20
      // 还原现场：假曲目不能残留到后续阶段（会被持久化并影响重启恢复断言）
      window.__test.useLibrary.setState({ tracks: before.tracks, trackOrder: before.trackOrder })
      await new Promise(r => requestAnimationFrame(r))
      return { renderMs, rows, mutateMs, restored: window.__test.useLibrary.getState().trackOrder.length }
    `)
    // 虚拟滚动下只挂载视口内的行，且无关状态变更不应触发整库序列化
    expect(r.rows < 100, '未启用虚拟滚动，渲染行数 ' + r.rows)
    expect(r.renderMs < 400, '3000 首渲染耗时过长: ' + Math.round(r.renderMs) + 'ms')
    expect(r.mutateMs < 3, '无关状态变更开销过大: ' + r.mutateMs.toFixed(1) + 'ms/次')
    expect(r.restored === 3, '性能测试未还原音乐库，残留 ' + r.restored + ' 首')
  })

  await test('持久化落盘（防抖+内容正确）', async () => {
    await ev(`window.__test.usePlayer.getState().setVolume(0.44)`)
    await sleep(1000)
    const data = JSON.parse(fs.readFileSync(path.join(USERDATA, 'library.json'), 'utf-8'))
    expect(Math.abs(data.settings.volume - 0.44) < 0.001, 'volume=' + data.settings.volume)
    expect(data.trackOrder.length === 3, 'trackOrder=' + data.trackOrder.length)
    expect(data.folders.some((f) => f.name === '测试文件夹'), '文件夹未持久化')
    expect((data.youtubeHistory ?? []).some((h) => h.videoId === 'dQw4w9WgXcQ'), '在线历史未持久化')
  })

  console.log(`\nPHASE1 RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

if (phase === '3') {
  await test('坏 library.json：空库启动不崩溃 + 自动备份', async () => {
    const r = await ev(`
      await new Promise(r => setTimeout(r, 800))
      const s = window.__test.useLibrary.getState()
      return { tracks: s.trackOrder.length, playlists: Object.keys(s.playlists).length, alive: !!document.querySelector('.empty-state') }
    `)
    expect(r.tracks === 0 && r.playlists === 0 && r.alive, JSON.stringify(r))
    const baks = fs.readdirSync(USERDATA).filter((f) => f.includes('.bak-'))
    expect(baks.length > 0, '未生成 .bak 备份文件')
  })
  console.log(`\nPHASE3 RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

if (phase === '2') {
  await test('重启后恢复：音乐库/歌单树/设置/上次曲目', async () => {
    const r = await ev(`
      await new Promise(r => setTimeout(r, 500))
      const s = window.__test.useLibrary.getState()
      const p = window.__test.usePlayer.getState()
      return {
        tracks: s.trackOrder.length,
        folder: s.folders.some(f => f.name === '测试文件夹'),
        playlist: Object.values(s.playlists).some(pl => pl.name === '我的歌单'),
        volume: p.volume,
        selected: p.queueIndex === 0 && p.queue.length === 1,
        notAutoPlaying: p.playing === false,
        history: s.youtubeHistory.some(h => h.videoId === 'dQw4w9WgXcQ'),
        sidebarPlaylist: [...document.querySelectorAll('.sidebar-item')].length >= 1
      }
    `)
    expect(r.tracks === 3, '音乐库恢复 ' + r.tracks)
    expect(r.folder && r.playlist, '歌单树恢复失败')
    expect(Math.abs(r.volume - 0.44) < 0.001, '音量恢复 ' + r.volume)
    expect(r.selected && r.notAutoPlaying, '上次曲目应选中未播放 ' + JSON.stringify(r))
    expect(r.history, '在线历史恢复失败')
  })

  await test('关闭窗口 → 停止播放并驻留托盘', async () => {
    const r = await ev(`
      const lib = window.__test.useLibrary.getState()
      window.__test.usePlayer.getState().startQueue(lib.trackOrder, 0)
      await new Promise(r => setTimeout(r, 600))
      const playingBefore = !window.__test.audio.paused
      window.api.windowControl('close')
      await new Promise(r => setTimeout(r, 600))
      const p = window.__test.usePlayer.getState()
      return { playingBefore, stoppedState: p.playing === false, stoppedAudio: window.__test.audio.paused, onlineClosed: p.showOnline === false }
    `)
    expect(r.playingBefore, '未能开始播放')
    expect(r.stoppedState && r.stoppedAudio, '关闭后未停止 ' + JSON.stringify(r))
  })

  console.log(`\nPHASE2 RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}
