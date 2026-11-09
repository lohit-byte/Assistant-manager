import type { MetadataRoute } from 'next'
import { site } from '@/lib/marketing'

export default function sitemap(): MetadataRoute.Sitemap {
  return ['/', '/legal'].map((path) => ({
    url: `${site.url}${path}`,
    lastModified: new Date('2026-11-09'),
  }))
}
