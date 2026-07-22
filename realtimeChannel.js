import { supabase } from './supabaseClient.js'

export function joinSessionChannel(
  sessionId,
  { presenceKey, presencePayload, onChange, onPresenceSync, onSubscribed, onError }
) {
  const channel = supabase.channel(`session:${sessionId}`, {
    config: { private: true, presence: { key: presenceKey } },
  })

  channel.on('broadcast', { event: 'INSERT' }, (msg) => onChange?.(msg.payload))
  channel.on('broadcast', { event: 'UPDATE' }, (msg) => onChange?.(msg.payload))

  channel.on('presence', { event: 'sync' }, () => {
    onPresenceSync?.(channel.presenceState())
  })

  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      if (presencePayload) await channel.track(presencePayload)
      await onSubscribed?.()
      return
    }

    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      onError?.(status)
    }
  })

  return channel
}
