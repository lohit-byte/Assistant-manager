import GuildShell from '@/components/guild-shell'

export default function GuildLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { guildId: string }
}) {
  return <GuildShell guildId={params.guildId}>{children}</GuildShell>
}
