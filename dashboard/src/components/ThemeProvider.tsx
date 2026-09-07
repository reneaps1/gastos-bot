'use client'
import { createContext, useContext, useState, useEffect, useCallback } from 'react'

export type Theme = 'light' | 'dark' | 'github-dark'

interface ThemeCtx {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeCtx>({ theme: 'light', setTheme: () => {}, toggleTheme: () => {} })

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    let stored: string | null = null
    try { stored = localStorage.getItem('theme') } catch { /* Storage may be disabled. */ }
    if (stored === 'light' || stored === 'dark' || stored === 'github-dark') {
      // Hydrate the persisted browser preference after the server render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTheme(stored)
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setTheme('dark')
    }
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return
    const root = document.documentElement
    if (theme !== 'light') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    root.dataset.theme = theme
    root.style.colorScheme = theme === 'light' ? 'light' : 'dark'
    try { localStorage.setItem('theme', theme) } catch { /* Keep the in-memory selection. */ }
  }, [theme, mounted])

  const toggleTheme = useCallback(() => {
    setTheme(t => t === 'light' ? 'dark' : t === 'dark' ? 'github-dark' : 'light')
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
