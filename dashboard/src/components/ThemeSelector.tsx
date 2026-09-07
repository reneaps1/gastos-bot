'use client'

import { useTheme, type Theme } from './ThemeProvider'

export function ThemeSelector() {
  const { theme, setTheme } = useTheme()
  return (
    <select
      aria-label="Tema de apariencia"
      title="Tema de apariencia"
      value={theme}
      onChange={event => setTheme(event.target.value as Theme)}
      className="max-w-32 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 cursor-pointer"
    >
      <option value="light">Claro</option>
      <option value="dark">Oscuro</option>
      <option value="github-dark">GitHub Dark</option>
    </select>
  )
}
