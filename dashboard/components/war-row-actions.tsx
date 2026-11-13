'use client'

import { useEffect, useRef, type KeyboardEvent } from 'react'
import { AlertTriangle, Plus, Trash2, UserPlus, X } from 'lucide-react'
import { Button, TextInput } from '@/components/ui'

/**
 * Row actions for the War page's Missing attacks table.
 *
 * Presentational only: the page owns which drawer is open, the reason text and every write.
 * The table lives in a scroll container, so the menu is an inline drawer `<tr>` under the clicked
 * row (a floating popover would be clipped by the container).
 */

/** Shown for a legacy name-only row: there is no Discord user behind it to act on. */
export const ADD_ALIAS_FIRST_LINE = 'Add an alias first — !alias add @user <name>'

export interface WarRowActionsCellProps {
  /** Display alias, used in the accessible names. */
  alias: string
  /** DOM ids; never derived from a Discord id. */
  plusId: string
  drawerId: string
  expanded: boolean
  onToggle: () => void
  /** The bin is only offered while the player is on the missing list. */
  canRemove: boolean
  removing?: boolean
  onRemove: () => void
}

const TAP =
  'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-transparent text-slate-400 transition-colors hover:border-white/[0.14] hover:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:cursor-not-allowed disabled:opacity-50'

/** The actions `<td>`: the `+` that opens the drawer, and the bin when the player is listed. */
export function WarRowActionsCell({
  alias,
  plusId,
  drawerId,
  expanded,
  onToggle,
  canRemove,
  removing = false,
  onRemove,
}: WarRowActionsCellProps) {
  return (
    <td className="px-1 py-1 text-right">
      <div className="flex items-center justify-end">
        <button
          type="button"
          id={plusId}
          onClick={onToggle}
          aria-haspopup="true"
          aria-expanded={expanded}
          aria-controls={expanded ? drawerId : undefined}
          aria-label={`Actions for ${alias}`}
          title="Actions"
          className={`${TAP} ${expanded ? 'border-accent-500/50 text-accent-300' : ''}`}
        >
          <Plus className={`h-4 w-4 transition-transform ${expanded ? 'rotate-45' : ''}`} aria-hidden />
        </button>
        {canRemove ? (
          <button
            type="button"
            onClick={onRemove}
            disabled={removing}
            className={`${TAP} hover:text-danger-300`}
            aria-label={`Remove ${alias} from the missing list`}
            title="Remove from missing"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>
    </td>
  )
}

export interface WarRowDrawerProps {
  id: string
  /** Number of table columns, so the drawer spans the full row. */
  colSpan: number
  alias: string
  /** False for legacy name-only rows: the drawer then offers no player actions. */
  hasDiscordId: boolean
  /** Why "Add to missing" is unavailable (excused, enough attacks, already listed), else null. */
  addBlockedReason: string | null
  /** Warn is staff-only; captains never see it. */
  canWarn: boolean
  warnOpen: boolean
  warnReason: string
  busy: 'add' | 'warn' | null
  onAdd: () => void
  onWarnOpen: () => void
  onWarnReasonChange: (value: string) => void
  onWarnSubmit: () => void
  /** Cancel, Escape or the close button: close the drawer. */
  onClose: () => void
}

/** The inline drawer row. Render it directly after the clicked row's `<tr>`. */
export function WarRowDrawer({
  id,
  colSpan,
  alias,
  hasDiscordId,
  addBlockedReason,
  canWarn,
  warnOpen,
  warnReason,
  busy,
  onAdd,
  onWarnOpen,
  onWarnReasonChange,
  onWarnSubmit,
  onClose,
}: WarRowDrawerProps) {
  const ref = useRef<HTMLDivElement>(null)

  // Keyboard users land on the first available action when the drawer opens.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button:not([disabled]), input')?.focus()
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
    }
  }

  return (
    <tr id={id} className="bg-slate-950/70">
      <td colSpan={colSpan} className="px-2 py-3">
        <div
          ref={ref}
          role="group"
          aria-label={`Actions for ${alias}`}
          onKeyDown={onKeyDown}
          className="border border-white/[0.1] bg-ink-950/60 px-3 py-3"
        >
          {!hasDiscordId ? (
            <div className="flex items-start justify-between gap-3">
              <p className="flex items-start gap-2 text-xs leading-relaxed text-warn-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{ADD_ALIAS_FIRST_LINE}</span>
              </p>
              <CloseButton onClose={onClose} />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="min-h-[40px]"
                  onClick={onAdd}
                  disabled={addBlockedReason !== null}
                  loading={busy === 'add'}
                >
                  <UserPlus className="h-3.5 w-3.5" aria-hidden /> Add to missing
                </Button>
                {canWarn ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="min-h-[40px]"
                    onClick={onWarnOpen}
                    aria-expanded={warnOpen}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Warn player
                  </Button>
                ) : null}
                <span className="ml-auto">
                  <CloseButton onClose={onClose} />
                </span>
              </div>

              {addBlockedReason ? (
                <p className="text-xs leading-relaxed text-slate-500">
                  Add to missing is unavailable: {addBlockedReason}
                </p>
              ) : null}

              {canWarn && warnOpen ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <TextInput
                    value={warnReason}
                    onChange={(event) => onWarnReasonChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        onWarnSubmit()
                      }
                    }}
                    placeholder="Reason for warning…"
                    aria-label={`Reason for warning ${alias}`}
                    className="min-h-[40px] sm:flex-1"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="min-h-[40px] flex-1 sm:flex-none"
                      onClick={onWarnSubmit}
                      loading={busy === 'warn'}
                    >
                      Record warning
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="min-h-[40px] flex-1 sm:flex-none"
                      onClick={onClose}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" onClick={onClose} className={TAP} aria-label="Close actions" title="Close">
      <X className="h-4 w-4" aria-hidden />
    </button>
  )
}
