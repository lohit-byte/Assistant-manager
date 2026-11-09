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

const toneText: Record<Tone, string> = {
  purple: 'text-indigo-300',
  green: 'text-emerald-300',
  red: 'text-rose-300',
  amber: 'text-amber-300',
  blue: 'text-sky-300',
  slate: 'text-slate-300',
}

const toneBg: Record<Tone, string> = {
  purple: 'bg-indigo-500/10 border-indigo-400/20',
  green: 'bg-emerald-500/10 border-emerald-400/20',
  red: 'bg-rose-500/10 border-rose-400/20',
  amber: 'bg-amber-500/10 border-amber-400/20',
  blue: 'bg-sky-500/10 border-sky-400/20',
  slate: 'bg-slate-500/10 border-slate-400/20',
}

const toneSolid: Record<Tone, string> = {
  purple: 'bg-indigo-500',
  green: 'bg-emerald-500',
  red: 'bg-rose-500',
  amber: 'bg-amber-500',
  blue: 'bg-sky-500',
  slate: 'bg-slate-500',
}

const toneGradient: Record<Tone, string> = {
  purple: 'from-indigo-500 to-violet-500',
  green: 'from-emerald-500 to-teal-400',
  red: 'from-rose-500 to-orange-400',
  amber: 'from-amber-500 to-orange-400',
  blue: 'from-sky-500 to-cyan-400',
  slate: 'from-slate-500 to-slate-400',
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
        'flex flex-wrap items-start justify-between gap-4 border-b border-white/[0.06] px-5 py-4 sm:px-6',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {icon ? (
          <div className="mt-0.5 rounded-xl border border-white/[0.07] bg-white/[0.04] p-2 text-indigo-300">
            {icon}
          </div>
        ) : null}
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-white sm:text-base">{title}</h2>
          {description ? <p className="mt-0.5 text-sm text-slate-400">{description}</p> : null}
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
    <div className="relative mb-8 overflow-hidden rounded-2xl border border-white/[0.06] bg-ink-800/40 px-5 py-6 sm:px-7 sm:py-7">
      <div className="bg-blueprint pointer-events-none absolute inset-0 opacity-60" aria-hidden />
      <div
        className="pointer-events-none absolute -right-24 -top-32 h-64 w-64 rounded-full bg-indigo-500/10 blur-3xl"
        aria-hidden
      />
      <div className="relative flex flex-wrap items-start justify-between gap-5">
        <div>
          {eyebrow ? (
            <span className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-indigo-400/20 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-300">
              {eyebrow}
            </span>
          ) : null}
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-[28px]">{title}</h1>
          {description ? (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">{description}</p>
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
    'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 disabled:cursor-not-allowed disabled:opacity-50'
  const variants: Record<ButtonVariant, string> = {
    primary:
      'bg-indigo-500 text-white shadow-[0_10px_30px_-12px_rgba(99,102,241,0.9)] hover:bg-indigo-400',
    secondary:
      'border border-white/[0.08] bg-white/[0.04] text-slate-200 hover:border-white/[0.14] hover:bg-white/[0.07]',
    danger: 'bg-rose-600 text-white hover:bg-rose-500',
    success: 'bg-emerald-600 text-white hover:bg-emerald-500',
    ghost: 'text-slate-400 hover:bg-white/[0.06] hover:text-white',
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
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide',
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
        'flex items-start gap-3 rounded-xl border px-4 py-3 text-sm backdrop-blur-sm',
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
          className="text-slate-400 transition-colors hover:text-white"
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
        <p className="text-xs text-rose-300">{error}</p>
      ) : hint ? (
        <p className="text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  )
}

export const inputClass =
  'w-full rounded-xl border border-white/[0.08] bg-ink-900/80 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 transition-colors focus:border-indigo-400/60 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 disabled:opacity-60'

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
          'relative h-7 w-12 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50',
          checked ? 'bg-indigo-500' : 'bg-white/[0.1]',
        )}
      >
        <span
          className={cn(
            'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-6' : 'translate-x-1',
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
        <div className="mb-1.5 flex items-center justify-between text-xs text-slate-400">
          <span>{label}</span>
          <span className="font-mono text-slate-300">{Math.round(pct)}%</span>
        </div>
      ) : null}
      <div
        className={cn(
          'overflow-hidden rounded-full bg-white/[0.06]',
          size === 'sm' ? 'h-1.5' : 'h-2',
        )}
      >
        <div
          className={cn(
            'h-full rounded-full bg-gradient-to-r transition-all duration-500',
            toneGradient[tone],
          )}
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
  const strokeClass = {
    purple: 'stroke-indigo-400',
    green: 'stroke-emerald-400',
    red: 'stroke-rose-400',
    amber: 'stroke-amber-400',
    blue: 'stroke-sky-400',
    slate: 'stroke-slate-400',
  }[tone]

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-white/[0.07]"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
          className={cn('transition-all duration-700', strokeClass)}
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
      <div
        className={cn(
          'pointer-events-none absolute -right-10 -top-14 h-28 w-28 rounded-full bg-gradient-to-br opacity-[0.13] blur-2xl',
          toneGradient[tone],
        )}
        aria-hidden
      />
      <div className="relative flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          {label}
        </p>
        {icon ? (
          <span className={cn('rounded-lg border p-1.5', toneBg[tone], toneText[tone])}>{icon}</span>
        ) : null}
      </div>
      <p className="relative mt-3 text-2xl font-bold tracking-tight text-white">{value}</p>
      {hint ? <p className="relative mt-1 text-xs text-slate-500">{hint}</p> : null}
      {footer ? <div className="relative mt-3">{footer}</div> : null}
    </div>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-400">
      <Loader2 className="h-5 w-5 animate-spin text-indigo-400" aria-hidden />
      <span>{label}</span>
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
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/[0.08] px-6 py-12 text-center">
      {icon ? <div className="mb-1 text-slate-600">{icon}</div> : null}
      <p className="font-semibold text-slate-300">{title}</p>
      {description ? <p className="max-w-sm text-sm text-slate-500">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-white/[0.06]', className)} />
}

export function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-ink-950 px-1.5 py-0.5 font-mono text-[0.8em] text-indigo-300">
      {children}
    </code>
  )
}
