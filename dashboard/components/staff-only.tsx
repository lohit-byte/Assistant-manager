'use client'

import { ShieldAlert } from 'lucide-react'
import { Card, CardBody } from '@/components/ui'

/**
 * Shown instead of staff-only pages (aliases, billing, maze) when the viewer is not server
 * staff. Team captains manage only their own team's war/race channels; read-only alias
 * members can view the snapshot but change nothing.
 */
export function StaffOnlyPanel({ area }: { area: string }) {
  return (
    <div className="max-w-2xl">
      <Card>
        <CardBody className="py-14 text-center">
          <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-slate-600" aria-hidden />
          <p className="text-lg font-semibold tracking-tight text-slate-200">Staff only</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">
            {area} is limited to server staff. Team captains can manage their own team&apos;s war
            and race channels, and read-only members cannot change server configuration. Ask a
            server manager if you need something changed.
          </p>
        </CardBody>
      </Card>
    </div>
  )
}
