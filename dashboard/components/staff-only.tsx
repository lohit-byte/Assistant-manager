'use client'

import { ShieldAlert } from 'lucide-react'
import { Card, CardBody } from '@/components/ui'

/**
 * Shown instead of staff-only pages (aliases, settings, billing) when the viewer has
 * read-only member access to a premium server.
 */
export function StaffOnlyPanel({ area }: { area: string }) {
  return (
    <div className="max-w-2xl">
      <Card>
        <CardBody className="py-14 text-center">
          <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-slate-600" aria-hidden />
          <p className="text-lg font-semibold tracking-tight text-slate-200">Staff only</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">
            {area} is limited to server staff. You have read-only member access to this premium
            server, so this page is not available. Ask a server manager if you need something
            changed.
          </p>
        </CardBody>
      </Card>
    </div>
  )
}
