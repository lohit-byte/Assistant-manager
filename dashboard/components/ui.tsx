'use client'

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { AlertCircle, CheckCircle2, Info, Loader2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/format'

export type Tone = 'purple' | 'green' | 'red' | 'amber' | 'blue' | 'slate'

/**
 * Tone names are kept from the old system so page code does not change. They now map to the
 * board palette: purple is the signal accent, blue is the cool defence steel, green is sage.
 */
const toneText: Record<Tone, string> = {
  purple: 'text-accent-400',
  green: 'text-sage-400',
  red: 'text-danger-400',
  amber: 'text-warn-400',
  blue: 'text-steel-400',
  slate: 'text-slate-400',
}

const toneBg: Record<Tone, string> = {
  purple: 'bg-accent-500/[0.08] border-accent-500/30',
  green: 'bg-sage-500/[0.08] border-sage-500/30',
  red: 'bg-danger-500/[0.08] border-danger-500/30',
  amber: 'bg-warn-500/[0.08] border-warn-500/30',
  blue: 'bg-steel-500/[0.08] border-steel-500/30',
  slate: 'bg-white/[0.03] border-white/[0.12]',
}

const toneSolid: Record<Tone, string> = {
  purple: 'bg-accent-500',
  green: 'bg-sage-500',
  red: 'bg-danger-500',
  amber: 'bg-warn-500',
  blue: 'bg-steel-500',
  slate: 'bg-slate-500',
}

const toneStroke: Record<Tone, string> = {
  purple: 'stroke-accent-500',
  green: 'stroke-sage-500',
  red: 'stroke-danger-500',
  amber: 'stroke-warn-500',
  blue: 'stroke-steel-500',
  slate: 'stroke-slate-500',
}

export function Card({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={cn('surface', className)}>{children}</div>
}

export function CardHeader({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-4 border-b border-white/[0.08] px-5 py-4 sm:px-6',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {icon ? (
          <div className="mt-0.5 border border-white/[0.1] bg-white/[0.02] p-2 text-accent-400">
            {icon}
          </div>
        ) : null}
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-slate-100">{title}</h2>
          {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
  )
}

export function CardBody({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={cn('px-5 py-5 sm:px-6', className)}>{children}</div>
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string
  description?: string
  actions?: ReactNode
  eyebrow?: string
}) {
  return (
    <div className="relative mb-8 border-b border-white/[0.1] pb-6 sm:pb-7">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          {eyebrow ? <p className="mono-label mb-2 text-accent-400">{eyebrow}</p> : null}
          <h1 className="display text-[28px] text-slate-50 sm:text-[36px]">{title}</h1>
          {description ? (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  )
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg'

export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-sm border font-semibold tracking-tight transition-[color,background-color,border-color,transform] duration-150 hover:-translate-y-px active:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 disabled:cursor-not-allowed disabled:opacity-50'
  const variants: Record<ButtonVariant, string> = {
    /*
     * The primary button flips to a light fill on hover in dark mode. In light mode `slate-200`
     * becomes dark and `ink-950` becomes paper, so the same classes still read: dark fill,
     * paper text. Solid danger/success fills dim on hover instead of inverting, because their
     * tokens double as text colours and would lose contrast.
     */
    primary:
      'border-accent-500 bg-accent-500 text-accent-ink hover:border-slate-200 hover:bg-slate-200 hover:text-ink-950',
    secondary:
      'border-white/[0.16] bg-transparent text-slate-200 hover:border-accent-500/60 hover:text-slate-50',
    danger:
      'border-danger-500 bg-danger-500 text-accent-ink hover:border-danger-500 hover:bg-danger-500 hover:opacity-90',
    success:
      'border-sage-500 bg-sage-500 text-accent-ink hover:border-sage-500 hover:bg-sage-500 hover:opacity-90',
    ghost:
      'border-transparent bg-transparent text-slate-400 hover:border-white/[0.12] hover:text-slate-100',
  }
  const sizes: Record<ButtonSize, string> = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2.5 text-sm',
    lg: 'px-6 py-3 text-base',
  }
  return cn(base, variants[variant], sizes[size], className)
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}) {
  return (
    <button
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  )
}

export function Badge({
  children,
  tone = 'slate',
  className,
  dot = false,
}: {
  children: ReactNode
  tone?: Tone
  className?: string
  dot?: boolean
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.12em]',
        toneBg[tone],
        toneText[tone],
        className,
      )}
    >
      {dot ? <span className={cn('h-1.5 w-1.5 rounded-full', toneSolid[tone])} /> : null}
      {children}
    </span>
  )
}

export function Alert({
  tone = 'blue',
  title,
  children,
  className,
  onDismiss,
}: {
  tone?: Tone
  title?: string
  children?: ReactNode
  className?: string
  onDismiss?: () => void
}) {
  const Icon =
    tone === 'green'
      ? CheckCircle2
      : tone === 'red'
        ? AlertCircle
        : tone === 'amber'
          ? AlertTriangle
          : Info

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-sm border border-l-2 px-4 py-3 text-sm',
        toneBg[tone],
        className,
      )}
      role="alert"
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', toneText[tone])} aria-hidden />
      <div className="min-w-0 flex-1">
        {title ? <p className={cn('font-semibold', toneText[tone])}>{title}</p> : null}
        {children ? <div className={cn('text-slate-300', title && 'mt-0.5')}>{children}</div> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="text-slate-400 transition-colors hover:text-slate-100"
          aria-label="Dismiss"
        >
          ×
        </button>
      ) : null}
    </div>
  )
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  className,
}: {
  label: string
  hint?: string
  error?: string
  children: ReactNode
  htmlFor?: string
  className?: string
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-slate-200">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-danger-400">{error}</p>
      ) : hint ? (
        <p className="text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  )
}

export const inputClass =
  'w-full rounded-sm border border-white/[0.14] bg-ink-950/70 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 transition-colors focus:border-accent-500/70 focus:outline-none focus:ring-2 focus:ring-accent-500/15 disabled:opacity-60'

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClass, className)} {...props} />
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputClass, 'min-h-[84px] resize-y', className)} {...props} />
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(inputClass, 'appearance-none', className)} {...props}>
      {children}
    </select>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div>
        <p className="text-sm font-semibold text-slate-200">{label}</p>
        {description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-7 w-[52px] shrink-0 overflow-hidden rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 disabled:opacity-50',
          checked ? 'border-accent-500 bg-accent-500' : 'border-white/[0.14] bg-white/[0.06]',
        )}
      >
        {/*
         * The knob is pinned with `left`/`top`, never its static position: the button's
         * default `text-align: center` centres the empty span, so a bare `translate-x`
         * used to start from the middle of the track and slide the knob clean out of it.
         * 22px knob + 2px offset inside the 1px border = a 3px inset all round; the
         * checked slide is the remaining travel (52 - 22 - 2*3 = 24px).
         */}
        <span
          className={cn(
            'absolute left-[2px] top-[2px] h-[22px] w-[22px] rounded-full bg-paper shadow transition-transform duration-200 ease-out',
            checked ? 'translate-x-[24px]' : 'translate-x-0',
          )}
        />
      </button>
    </div>
  )
}

export function ProgressBar({
  value,
  max,
  tone = 'purple',
  label,
  className,
  size = 'md',
}: {
  value: number
  max: number
  tone?: Tone
  label?: string
  className?: string
  size?: 'sm' | 'md'
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div className={className}>
      {label ? (
        <div className="mb-1.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">
          <span>{label}</span>
          <span className="text-slate-300">{Math.round(pct)}%</span>
        </div>
      ) : null}
      <div
        className={cn('overflow-hidden rounded-sm bg-white/[0.08]', size === 'sm' ? 'h-1' : 'h-2')}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Progress'}
      >
        <div
          className={cn('h-full rounded-sm transition-[width] duration-500', toneSolid[tone])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

/**
 * Donut progress ring. Used for trial days and race progress where the
 * proportion matters more than the raw number.
 */
export function Ring({
  value,
  max,
  tone = 'purple',
  size = 84,
  stroke = 8,
  children,
}: {
  value: number
  max: number
  tone?: Tone
  size?: number
  stroke?: number
  children?: ReactNode
}) {
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-white/[0.08]"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="butt"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
          className={cn('transition-all duration-700', toneStroke[tone])}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {children}
      </div>
    </div>
  )
}

export function Stat({
  label,
  value,
  hint,
  icon,
  tone = 'purple',
  className,
  footer,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  tone?: Tone
  className?: string
  footer?: ReactNode
}) {
  return (
    <div className={cn('surface relative overflow-hidden p-5', className)}>
      <div className="relative flex items-start justify-between gap-3">
        <p className="mono-label">{label}</p>
        {icon ? (
          <span className={cn('border p-1.5', toneBg[tone], toneText[tone])}>{icon}</span>
        ) : null}
      </div>
      <p className="relative mt-3 font-display text-2xl font-extrabold tracking-tight text-slate-50">
        {value}
      </p>
      {hint ? <p className="relative mt-1 font-mono text-[11px] text-slate-500">{hint}</p> : null}
      {footer ? <div className="relative mt-3">{footer}</div> : null}
    </div>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin text-accent-500" aria-hidden />
      <span className="font-mono text-[11px] uppercase tracking-[0.12em]">{label}</span>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-white/[0.12] px-6 py-12 text-center">
      {icon ? <div className="mb-1 text-slate-600">{icon}</div> : null}
      <p className="font-semibold text-slate-300">{title}</p>
      {description ? <p className="max-w-sm text-sm text-slate-500">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-white/[0.08]', className)} />
}

export function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-sm border border-white/[0.08] bg-ink-950 px-1.5 py-0.5 font-mono text-[0.8em] text-accent-300">
      {children}
    </code>
  )
}
