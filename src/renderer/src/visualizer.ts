import { audio } from './hooks/useAudio'

// MediaElementSource 每个媒体元素只能创建一次，全局单例；
// 创建后音频永久经由此图输出，AudioContext 保持 running
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
  if (ctx?.state === 'suspended') {
    void ctx.resume()
  }
  return analyser
}
