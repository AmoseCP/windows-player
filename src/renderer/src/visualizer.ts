import { audio } from './hooks/useAudio'

// MediaElementSource 每个媒体元素只能创建一次，全局单例；
// 创建后音频永久经由此图输出，因此 AudioContext 必须保持 running
let analyser: AnalyserNode | null = null
let ctx: AudioContext | null = null

/** 惰性创建音频分析器（首次打开可视化时调用） */
export function getAnalyser(): AnalyserNode {
  if (!analyser) {
    ctx = new AudioContext()
    const source = ctx.createMediaElementSource(audio)
    analyser = ctx.createAnalyser()
    analyser.fftSize = 128 // 64 个频率桶，足够画律动条
    analyser.smoothingTimeConstant = 0.82
    source.connect(analyser)
    analyser.connect(ctx.destination)
  }
  resumeAnalyserContext()
  return analyser
}

/** 恢复被自动播放策略挂起的音频图；未创建时为空操作。每次播放都应调用。 */
export function resumeAnalyserContext(): void {
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume()
  }
}
