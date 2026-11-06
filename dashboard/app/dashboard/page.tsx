import { redirect } from 'next/navigation'
import ServerPicker from '@/components/server-picker'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/')

  return <ServerPicker />
}
