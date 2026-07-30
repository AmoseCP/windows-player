/** 整体配色主题：通过 CSS 变量切换（--overlay/--glass/--panel 供背景图叠加与面板使用） */
export interface ColorTheme {
  label: string
  vars: Record<string, string>
}

export const COLOR_THEMES: Record<string, ColorTheme> = {
  dark: {
    label: '深色（默认）',
    vars: {
      '--bg-app': '#121212',
      '--bg-raised': '#1c1c1e',
      '--bg-hover': '#2a2a2d',
      '--bg-active': '#333338',
      '--text-primary': '#f2f2f2',
      '--text-secondary': '#a0a0a8',
      '--text-muted': '#6a6a72',
      '--accent': '#4f8cff',
      '--border': '#2c2c30',
      '--overlay': 'rgba(12, 12, 14, 0.82)',
      '--glass': 'rgba(20, 20, 22, 0.55)',
      '--panel': 'rgba(14, 14, 16, 0.97)'
    }
  },
  pink: {
    label: '浅粉',
    vars: {
      '--bg-app': '#fdf2f6',
      '--bg-raised': '#fce7ee',
      '--bg-hover': '#f8d9e4',
      '--bg-active': '#f3c7d7',
      '--text-primary': '#43222f',
      '--text-secondary': '#8a5a6c',
      '--text-muted': '#b78d9c',
      '--accent': '#e05585',
      '--border': '#f2d3e0',
      '--overlay': 'rgba(253, 242, 246, 0.84)',
      '--glass': 'rgba(252, 231, 238, 0.6)',
      '--panel': 'rgba(253, 242, 246, 0.97)'
    }
  },
  red: {
    label: '浅红',
    vars: {
      '--bg-app': '#fdf3f1',
      '--bg-raised': '#fbe6e2',
      '--bg-hover': '#f7d6d0',
      '--bg-active': '#f1c2ba',
      '--text-primary': '#442420',
      '--text-secondary': '#8f5c53',
      '--text-muted': '#bb9188',
      '--accent': '#d9534f',
      '--border': '#f2d2cb',
      '--overlay': 'rgba(253, 243, 241, 0.84)',
      '--glass': 'rgba(251, 230, 226, 0.6)',
      '--panel': 'rgba(253, 243, 241, 0.97)'
    }
  },
  blue: {
    label: '淡蓝',
    vars: {
      '--bg-app': '#f1f6fd',
      '--bg-raised': '#e3edfa',
      '--bg-hover': '#d2e2f6',
      '--bg-active': '#bed4f0',
      '--text-primary': '#1d2b3e',
      '--text-secondary': '#56708f',
      '--text-muted': '#8ba0ba',
      '--accent': '#3d78d8',
      '--border': '#d3e0f0',
      '--overlay': 'rgba(241, 246, 253, 0.84)',
      '--glass': 'rgba(227, 237, 250, 0.6)',
      '--panel': 'rgba(241, 246, 253, 0.97)'
    }
  },
  purple: {
    label: '浅紫',
    vars: {
      '--bg-app': '#f7f3fd',
      '--bg-raised': '#eee5fa',
      '--bg-hover': '#e1d3f6',
      '--bg-active': '#d2bef0',
      '--text-primary': '#2f2342',
      '--text-secondary': '#6f5b90',
      '--text-muted': '#a08cbb',
      '--accent': '#8a5cd6',
      '--border': '#e0d3f0',
      '--overlay': 'rgba(247, 243, 253, 0.84)',
      '--glass': 'rgba(238, 229, 250, 0.6)',
      '--panel': 'rgba(247, 243, 253, 0.97)'
    }
  },
  orange: {
    label: '橙色',
    vars: {
      '--bg-app': '#fdf6ee',
      '--bg-raised': '#fbead8',
      '--bg-hover': '#f7dcc0',
      '--bg-active': '#f1cba2',
      '--text-primary': '#402d16',
      '--text-secondary': '#8f6c43',
      '--text-muted': '#b99a72',
      '--accent': '#e07f1f',
      '--border': '#f2ddc4',
      '--overlay': 'rgba(253, 246, 238, 0.84)',
      '--glass': 'rgba(251, 234, 216, 0.6)',
      '--panel': 'rgba(253, 246, 238, 0.97)'
    }
  }
}

export function applyColorTheme(id: string): void {
  const theme = COLOR_THEMES[id] ?? COLOR_THEMES.dark
  for (const [key, value] of Object.entries(theme.vars)) {
    document.documentElement.style.setProperty(key, value)
  }
}
