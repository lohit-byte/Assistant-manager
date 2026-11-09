import { Archivo, JetBrains_Mono } from 'next/font/google'

/**
 * Archivo carries the whole system: the width axis is pushed wide for display type and left
 * normal for text. JetBrains Mono is only for clocks, counters, commands and coordinates.
 */
export const archivo = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-archivo',
  display: 'swap',
})

export const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  preload: false,
})
