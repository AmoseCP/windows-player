/// <reference types="vite/client" />

import type { DetailedHTMLProps, HTMLAttributes } from 'react'

// Electron <webview> 标签（在线播放加载 YouTube 观看页）
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & { src?: string; partition?: string },
        HTMLElement
      >
    }
  }
}
