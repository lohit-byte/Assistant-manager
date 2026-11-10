import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import {safeFetch } from './safe-fetch'

let browserClient: SupabaseClient | null = null

export function createClient(): SupabaseClient {
  if (!browserClient) {
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: {fetch: safeFetch } },
    )
  }
  return browserClient
}

/**
 * Ends the session and reloads the landing page.
 *
 * A client-side `router.replace('/')` is not enough: the App Router can answer with a cached
 * payload for the signed-in state, so the shell bounces back to the dashboard after the auth
 * cookies are gone. A full page load re-reads the cookies on the server.
 */
export async function signOutToHome(): Promise<void> {
  try {
    await createClient().auth.signOut()
  } catch {
    // The refresh token may already be expired; there is nothing left to revoke.
  }
  window.location.replace('/')
}
