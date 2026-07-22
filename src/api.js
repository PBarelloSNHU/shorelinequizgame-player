import { supabase } from './supabaseClient.js'

export async function joinSession({ code, name }) {
  const { data, error } = await supabase.rpc('join_session', { p_code: code, p_name: name })
  if (error) throw error
  return data[0] // { player_id, session_id, status, current_question_index }
}

export async function submitAnswer(sessionId, orderIndex, selectedIndex) {
  const { data, error } = await supabase.rpc('submit_answer', {
    p_session_id: sessionId,
    p_order_index: orderIndex,
    p_selected: selectedIndex,
  })
  if (error) throw error
  return data // boolean is_correct
}

export async function tryAdvanceIfExpired(sessionId) {
  await supabase.rpc('try_advance_if_expired', { p_session_id: sessionId })
}

export async function fetchSession(sessionId) {
  const { data, error } = await supabase.from('quiz_sessions').select('*').eq('id', sessionId).single()
  if (error) throw error
  return data
}

export async function fetchRoster(sessionId) {
  const { data, error } = await supabase.from('quiz_players').select('*').eq('session_id', sessionId)
  if (error) throw error
  return data
}

export async function fetchScoreboard(sessionId) {
  const { data, error } = await supabase
    .from('quiz_scores')
    .select('player_id, total_score, correct_count, quiz_players(display_name)')
    .eq('session_id', sessionId)
    .order('total_score', { ascending: false })
  if (error) throw error
  return data
}

export async function fetchCurrentQuestion(sessionId) {
  const { data, error } = await supabase.rpc('get_current_question', { p_session_id: sessionId })
  if (error) throw error
  return data[0]
}

export async function fetchRevealedQuestion(sessionId) {
  const { data, error } = await supabase.rpc('get_revealed_question', { p_session_id: sessionId })
  if (error) throw error
  return data[0]
}
