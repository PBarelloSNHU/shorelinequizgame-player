import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true } }
)

// Stable anonymous identity per device — a refresh reconnects as the SAME
// player instead of a new one, which is what makes rejoin-after-refresh work.
export async function ensureAnonymousSession() {
  const { data } = await supabase.auth.getSession()
  let session = data.session

  if (!session) {
    const { data: signIn, error } = await supabase.auth.signInAnonymously()
    if (error) throw error
    session = signIn.session
  }

  // Realtime private channels (see realtimeChannel.js) are authorized by
  // evaluating RLS policies against the connected user's JWT. supabase-js
  // syncs this automatically on auth state changes in most versions, but
  // we set it explicitly here too so the very first channel.subscribe()
  // call — which can race the auth listener — always has a token to check.
  if (session?.access_token) {
    supabase.realtime.setAuth(session.access_token)
  }

  return session
}
