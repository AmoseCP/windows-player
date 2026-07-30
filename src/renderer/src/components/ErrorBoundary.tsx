import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface State {
  error: Error | null
}

/** 兜底错误边界：任一组件抛错时给出可恢复的提示，而不是整窗白屏 */
class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('界面渲染出错:', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="crash-screen">
        <div className="crash-title">界面出现异常</div>
        <div className="crash-detail">{this.state.error.message}</div>
        <div className="crash-actions">
          <button className="btn" onClick={() => this.setState({ error: null })}>
            重试
          </button>
          <button className="btn" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </div>
        <div className="crash-hint">音乐库与歌单数据已保存，重新加载不会丢失。</div>
      </div>
    )
  }
}

export default ErrorBoundary
