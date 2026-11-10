'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Appearance preference for the dashboard.
 *
 * Stored per browser (not per Discord account) so a staff member can keep a light dashboard on
 * their phone without changing what anyone else sees. The root layout applies the stored
 * preference before first paint; `useTheme` keeps the setting in sync after hydration.
 */
export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'legends-theme'

/** Kept here so the pre-paint script in app/layout.tsx and the Settings page agree. */
export const THEME_COLORS: Record<ResolvedTheme, string> = {
  dark: '#0c0d0a',
  light: '#f5efe2',
}

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function readThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system'
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // Private mode can block localStorage; fall back to the device setting.
  }
  return 'system'
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? systemTheme() : preference
}

/** Applies a preference to <html> and updates the browser chrome colour. */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference)
  if (typeof document === 'undefined') return resolved
  const root = document.documentElement
  root.dataset.theme = resolved
  root.style.colorScheme = resolved
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_COLORS[resolved])
  return resolved
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>('system')
  const [resolved, setResolved] = useState<ResolvedTheme>('dark')

  useEffect(() => {
    const stored = readThemePreference()
    setPreference(stored)
    setResolved(applyTheme(stored))

    // "Match device" must react if the device switches theme while the dashboard is open.
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const onSystemChange = () => {
      if (readThemePreference() === 'system') {
        setResolved(applyTheme('system'))
      }
    }
    media.addEventListener('change', onSystemChange)
    return () => media.removeEventListener('change', onSystemChange)
  }, [])

  const setTheme = useCallback((next: ThemePreference) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Preference still applies for this page view even if it cannot be saved.
    }
    setPreference(next)
    setResolved(applyTheme(next))
  }, [])

  return { preference, resolved, setTheme }
}
