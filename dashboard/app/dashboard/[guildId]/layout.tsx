import GuildShell from '@/components/guild-shell'

export default function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { guildId: string }
}) {
  return (
    <GuildShell key={params.guildId} guildId={params.guildId}>
      {children}
    </GuildShell>
  )
}
