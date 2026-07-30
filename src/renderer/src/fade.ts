/**
 * 淡入淡出：统一接管 audio.volume。
 * 最终音量 = 用户音量 × 渐变系数，因此渐变与音量滑块互不冲突。
 */
let userVolume = 0.8
let gain = 1
let timer: ReturnType<typeof setInterval> | undefined
const STEP_MS = 40

function applyVolume(el: HTMLAudioElement): void {
  el.volume = Math.min(1, Math.max(0, userVolume * gain))
}

/** 音量滑块变化时调用 */
export function setUserVolume(el: HTMLAudioElement, v: number): void {
  userVolume = v
  applyVolume(el)
}

function ramp(el: HTMLAudioElement, target: number, seconds: number, done?: () => void): void {
  clearInterval(timer)
  if (seconds <= 0) {
    gain = target
    applyVolume(el)
    done?.()
    return
  }
  const stepDelta = (target - gain) / Math.max(1, (seconds * 1000) / STEP_MS)
  timer = setInterval(() => {
    gain += stepDelta
    const reached = stepDelta >= 0 ? gain >= target : gain <= target
    if (reached) {
      gain = target
      clearInterval(timer)
      timer = undefined
      applyVolume(el)
      done?.()
      return
    }
    applyVolume(el)
  }, STEP_MS)
}

/** 开始播放：从静音渐入（seconds=0 时直接全量） */
export function fadeIn(el: HTMLAudioElement, seconds: number): void {
  if (seconds <= 0) {
    clearInterval(timer)
    gain = 1
    applyVolume(el)
    return
  }
  gain = 0
  applyVolume(el)
  ramp(el, 1, seconds)
}

/** 暂停/停止：渐出后执行 onDone（通常是 pause），并把系数复位备下次淡入 */
export function fadeOut(el: HTMLAudioElement, seconds: number, onDone: () => void): void {
  if (seconds <= 0) {
    clearInterval(timer)
    onDone()
    gain = 1
    applyVolume(el)
    return
  }
  ramp(el, 0, seconds, () => {
    onDone()
    gain = 1
    applyVolume(el)
  })
}

/** 取消进行中的渐变并恢复满音量（如切歌打断淡出） */
export function cancelFade(el: HTMLAudioElement): void {
  clearInterval(timer)
  timer = undefined
  gain = 1
  applyVolume(el)
}
