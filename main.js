import { ensureAnonymousSession } from './supabaseClient.js'
import * as api from './api.js'
import { joinSessionChannel } from './realtimeChannel.js'
import {
  renderJoin,
  renderWaitingRoom,
  renderQuestionAnswer,
  renderFeedback,
  renderFinalScore,
} from './views.js'

const app = document.querySelector('#app')

let sessionId = localStorage.getItem('tq357_player_session_id')
let playerId = localStorage.getItem('tq357_player_id')

let session = null
let myAnswer = null
let myAnsweredIndex = null // which question index myAnswer belongs to
let scoreboard = []
let channel = null
let expiryPoll = null

async function boot() {
  await ensureAnonymousSession()
  if (sessionId && playerId) {
    try {
      session = await api.fetchSession(sessionId)
      subscribe()
      await render()
      return
    } catch {
      // stale localStorage pointing at a session that no longer exists — fall through to Join
    }
  }
  const urlCode = new URL(window.location.href).searchParams.get('code') || ''
  renderJoin(app, { prefillCode: urlCode, onJoin: handleJoin })
}

async function handleJoin({ code, name }) {
  if (!code || !name) {
    renderJoin(app, { prefillCode: code, onJoin: handleJoin, error: 'Enter both a code and your name.' })
    return
  }
  try {
    const result = await api.joinSession({ code, name })
    sessionId = result.session_id
    playerId = result.player_id
    localStorage.setItem('tq357_player_session_id', sessionId)
    localStorage.setItem('tq357_player_id', playerId)

    session = await api.fetchSession(sessionId)
    subscribe()
    await render()
  } catch (err) {
    renderJoin(app, { prefillCode: code, onJoin: handleJoin, error: friendlyError(err) })
  }
}

function friendlyError(err) {
  if (err.message?.includes('session_not_found')) return 'That code was not found — double check with the host.'
  if (err.message?.includes('session_full')) return 'This session is already full (30 players).'
  return 'Something went wrong — try again.'
}

function subscribe() {
  channel = joinSessionChannel(sessionId, {
    presenceKey: playerId,
    presencePayload: { role: 'player' },
    onChange: handleBroadcast,
    onPresenceSync: () => {},
  })

  // Resilience net (see architecture doc §9): any player's tab can also
  // trigger the on-time lock, not just the host's.
  expiryPoll = setInterval(() => {
    if (session?.status === 'question_live') api.tryAdvanceIfExpired(sessionId)
  }, 1000)
}

async function handleBroadcast(payload) {
  if (payload.table === 'quiz_sessions') {
    session = payload.record
    await render()
  } else if (payload.table === 'quiz_scores') {
    scoreboard = await api.fetchScoreboard(sessionId)
    render()
  }
}

async function render() {
  switch (session.status) {
    case 'lobby': {
      const roster = await api.fetchRoster(sessionId)
      renderWaitingRoom(app, { rosterCount: roster.length })
      break
    }
    case 'question_live': {
      const question = await api.fetchCurrentQuestion(sessionId)
      const alreadySubmitted = myAnsweredIndex === session.current_question_index
      renderQuestionAnswer(app, {
        question,
        session,
        submitted: alreadySubmitted,
        onSubmit: async (selectedIndex) => {
          myAnswer = selectedIndex
          myAnsweredIndex = session.current_question_index
          try {
            await api.submitAnswer(sessionId, session.current_question_index, selectedIndex)
          } catch (err) {
            console.warn('answer rejected:', err.message) // e.g. answer_too_late
          }
        },
      })
      break
    }
    case 'reveal': {
      const revealed = await api.fetchRevealedQuestion(sessionId)
      scoreboard = await api.fetchScoreboard(sessionId)
      const myAnswerForThisQuestion = myAnsweredIndex === session.current_question_index ? myAnswer : null
      renderFeedback(app, {
        question: revealed,
        correctIndex: revealed.correct_index,
        myAnswer: myAnswerForThisQuestion,
        scoreboard,
      })
      break
    }
    case 'ended': {
      scoreboard = await api.fetchScoreboard(sessionId)
      renderFinalScore(app, {
        scoreboard,
        myPlayerId: playerId,
        onPlayAgain: handlePlayAgain,
      })
      break
    }
  }
}

function handlePlayAgain() {
  localStorage.removeItem('tq357_player_session_id')
  localStorage.removeItem('tq357_player_id')
  channel?.unsubscribe()
  clearInterval(expiryPoll)
  sessionId = null
  playerId = null
  session = null
  myAnswer = null
  myAnsweredIndex = null
  renderJoin(app, { onJoin: handleJoin })
}

async function resyncSessionState() {
  if (!sessionId) return

  session = await api.fetchSession(sessionId)

  if (session.status === 'lobby') {
    scoreboard = []
  } else if (session.status === 'reveal' || session.status === 'ended') {
    scoreboard = await api.fetchScoreboard(sessionId)
  }

  await render()
}

function subscribe() {
  channel = joinSessionChannel(sessionId, {
    presenceKey: playerId,
    presencePayload: { role: 'player' },
    onChange: handleBroadcast,
    onPresenceSync: () => {},
    onSubscribed: resyncSessionState,
    onError: () => resyncSessionState(),
  })

  expiryPoll = setInterval(() => {
    if (session?.status === 'question_live') api.tryAdvanceIfExpired(sessionId)
  }, 1000)
}

window.addEventListener('focus', () => {
  resyncSessionState().catch(console.error)
})

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    resyncSessionState().catch(console.error)
  }
})

boot()
