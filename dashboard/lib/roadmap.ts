export type RoadmapStatus = 'in-progress' | 'planned' | 'shipped'
export type UpdateArea = 'Bot' | 'Dashboard' | 'Billing'
export type BotState = 'operational' | 'degraded' | 'maintenance'

export interface RoadmapItem {
  id: string
  title: string
  description: string
  status: RoadmapStatus
  area: UpdateArea
  eta?: string
  shippedAt?: string
}

export interface MaintenanceWindow {
  id: string
  title: string
  startsAt: string
  endsAt: string
  notes?: string
}

export const BOT_STATUS: {
  state: BotState
  label: string
  summary: string
  note: string
  updatedAt: string
} = {
  state: 'operational',
  label: 'Operational',
  summary: 'No platform-wide outage is being reported.',
  note: 'This status is updated manually. If commands are not responding, contact support.',
  updatedAt: '2026-11-06T00:00:00Z',
}

export const MAINTENANCE_WINDOWS: MaintenanceWindow[] = []

export const ROADMAP: RoadmapItem[] = [
  {
    id: 'regional-pricing',
    title: 'Regional pricing',
    description:
      'Monthly and yearly plans priced in INR for India and USD everywhere else, with automatic region detection.',
    status: 'in-progress',
    area: 'Billing',
    eta: 'This week',
  },
  {
    id: 'trial-abuse-protection',
    title: 'Trial abuse protection',
    description:
      'Blacklisted servers and player accounts are blocked from new trials and upgrades.',
    status: 'in-progress',
    area: 'Billing',
    eta: 'This week',
  },
  {
    id: 'maintenance-notices',
    title: 'Maintenance notices',
    description:
      'Scheduled downtime and bot status are published on the updates page in your local timezone.',
    status: 'in-progress',
    area: 'Dashboard',
    eta: 'This week',
  },
  {
    id: 'automatic-activation',
    title: 'Automatic activation',
    description:
      'Self-serve payment links that activate premium without waiting for a manual support reply.',
    status: 'planned',
    area: 'Billing',
    eta: 'Planned',
  },
  {
    id: 'renewal-reminders',
    title: 'Renewal reminders',
    description:
      'Dashboard and email reminders before a paid plan or trial comes to an end.',
    status: 'planned',
    area: 'Billing',
    eta: 'Planned',
  },
  {
    id: 'billing-history',
    title: 'Billing history',
    description:
      'A per-server record of plan changes, activation dates and renewal dates.',
    status: 'planned',
    area: 'Billing',
    eta: 'Planned',
  },
  {
    id: 'dashboard-v2',
    title: 'Dashboard v2',
    description:
      'Every page rebuilt against the same Supabase tables the bot uses, with shared loading and error states.',
    status: 'shipped',
    area: 'Dashboard',
    shippedAt: '2026-11-06',
  },
  {
    id: 'war-race-maze',
    title: 'War, race and maze controls',
    description:
      'Phase timers, missing and excused lists, race progress and maze discount schedules in one place.',
    status: 'shipped',
    area: 'Dashboard',
    shippedAt: '2026-11-06',
  },
  {
    id: 'aliases-warnings',
    title: 'Alias and warning management',
    description:
      'Aliases and warnings stay in sync with the bot and no longer require manual commands.',
    status: 'shipped',
    area: 'Dashboard',
    shippedAt: '2026-11-06',
  },
  {
    id: 'plan-status',
    title: 'Plan and trial status',
    description:
      'A read-only billing page shows the current plan, trial countdown and activation state.',
    status: 'shipped',
    area: 'Billing',
    shippedAt: '2026-11-06',
  },
]
