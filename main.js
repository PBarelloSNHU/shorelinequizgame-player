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
let myAnsweredIndex = null
let scoreboard = []
let currentQuestion = null
let revealedQuestion = null
let rosterCount = 0
let channel = null
let expiryPoll = null
let resyncPromise = null
let resyncError = null // NEW: surface fetch failures instead of hanging

async function boot() {
  await ensureAnonymousSession()

  if (sessionId && playerId) {
    try {
      subscribe()
      await resyncPlayerState()
      return
    } catch (err) {
      console.error('[player] failed to restore session:', err)
      clearPlayerState()
    }
  }

  const urlCode = new URL(window.location.href).searchParams.get('code') || ''
  renderJoin(app, { prefillCode: urlCode, onJoin: handleJoin })
}

async function handleJoin({ code, name }) {
  if (!code || !name) {
    renderJoin(app, {
      prefillCode: code,
      onJoin: handleJoin,
      error: 'Enter both a code and your name.',
    })
    return
  }

  try {
    const result = await api.joinSession({ code, name })
    sessionId = result.session_id
    playerId = result.player_id

    localStorage.setItem('tq357_player_session_id', sessionId)
    localStorage.setItem('tq357_player_id', playerId)

    subscribe()
    await resyncPlayerState()
  } catch (err) {
    console.error('[player] join failed:', err)
    renderJoin(app, {
      prefillCode: code,
      onJoin: handleJoin,
      error: friendlyError(err),
    })
  }
}

function friendlyError(err) {
  if (err.message?.includes('session_not_found')) {
    return 'That code was not found — double check with the host.'
  }
  if (err.message?.includes('session_full')) {
    return 'This session is already full (30 players).'
  }
  return 'Something went wrong — try again.'
}

function subscribe() {
  if (!sessionId || !playerId || channel) return

  channel = joinSessionChannel(sessionId, {
    presenceKey: playerId,
    presencePayload: { role: 'player' },
    onChange: handleBroadcast,
    onPresenceSync: () => {},
  })

  if (!expiryPoll) {
    expiryPoll = setInterval(async () => {
      if (session?.status !== 'question_live') return

      try {
        console.log('[player] tryAdvanceIfExpired tick', {
          sessionId,
          status: session.status,
          current_question_index: session.current_question_index,
        })

        await api.tryAdvanceIfExpired(sessionId)

        const freshSession = await api.fetchSession(sessionId)
        if (
          freshSession.status !== session.status ||
          freshSession.current_question_index !== session.current_question_index
        ) {
          session = freshSession
          await resyncPlayerState()
        }
      } catch (err) {
        console.warn('[player] expiry poll failed:', err)
      }
    }, 1000)
  }
}

async function handleBroadcast(payload) {
  console.log(
    '[player] broadcast received:',
    payload?.table,
    payload?.record?.status,
    payload
  )

  const table = payload?.table

  if (table === 'quiz_sessions') {
    session = payload.record

    try {
      await resyncPlayerState()
    } catch (err) {
      console.error('[player] resync after quiz_sessions broadcast failed:', err)
    }
    return
  }

  if (!sessionId) return

  if (table === 'quiz_scores') {
    try {
      scoreboard = await api.fetchScoreboard(sessionId)
      render()
    } catch (err) {
      console.warn('[player] failed to refresh scoreboard:', err)
    }
    return
  }

  if (table === 'quiz_players' && session?.status === 'lobby') {
    try {
      const roster = await api.fetchRoster(sessionId)
      rosterCount = roster.length
      render()
    } catch (err) {
      console.warn('[player] failed to refresh roster:', err)
    }
  }
}

async function resyncPlayerState() {
  if (!sessionId) return
  if (resyncPromise) return resyncPromise

  resyncPromise = (async () => {
    resyncError = null

    const freshSession = await api.fetchSession(sessionId)
    session = freshSession

    currentQuestion = null
    revealedQuestion = null

    try {
      if (session.status === 'lobby') {
        const roster = await api.fetchRoster(sessionId)
        rosterCount = roster.length
        scoreboard = []
      } else if (session.status === 'question_live') {
        currentQuestion = await api.fetchCurrentQuestion(sessionId)
        if (!currentQuestion) {
          throw new Error('fetchCurrentQuestion returned no data')
        }
      } else if (session.status === 'reveal') {
        revealedQuestion = await api.fetchRevealedQuestion(sessionId)
        if (!revealedQuestion) {
          throw new Error('fetchRevealedQuestion returned no data')
        }
        scoreboard = await api.fetchScoreboard(sessionId)
      } else if (session.status === 'ended') {
        scoreboard = await api.fetchScoreboard(sessionId)
      }
    } catch (err) {
      // Surface the failure instead of leaving stale null data with a silent render no-op.
      console.error('[player] failed to load state for status', session.status, err)
      resyncError = err
    }

    console.log('[player] resynced player state:', {
      status: session.status,
      rosterCount,
      currentQuestionIndex: session.current_question_index,
      scoreboardCount: scoreboard.length,
      myAnsweredIndex,
      resyncError: resyncError?.message ?? null,
    })

    render()
  })()

  try {
    await resyncPromise
  } finally {
    resyncPromise = null
  }
}

function renderStatusMessage(message, { isError = false } = {}) {
  app.innerHTML = `
    <div class="player-status ${isError ? 'player-status--error' : ''}">
      <p>${message}</p>
    </div>
  `
}

function render() {
  if (!session) {
    const urlCode = new URL(window.location.href).searchParams.get('code') || ''
    renderJoin(app, { prefillCode: urlCode, onJoin: handleJoin })
    return
  }

  console.log('[player] render status:', session.status, {
    hasCurrentQuestion: !!currentQuestion,
    hasRevealedQuestion: !!revealedQuestion,
    resyncError: resyncError?.message ?? null,
  })

  // Surface a real error instead of leaving the page frozen on a stale placeholder.
  if (resyncError) {
    renderStatusMessage(
      'Having trouble loading this question. Retrying…',
      { isError: true }
    )
    return
  }

  switch (session.status) {
    case 'lobby':
      renderWaitingRoom(app, { rosterCount })
      break

    case 'question_live': {
      // Loading state, NOT a silent no-op — keeps DOM in sync with reality.
      if (!currentQuestion) {
        renderStatusMessage('Loading question…')
        return
      }

      const alreadySubmitted = myAnsweredIndex === session.current_question_index

      renderQuestionAnswer(app, {
        question: currentQuestion,
        session,
        submitted: alreadySubmitted,
        onSubmit: async (selectedIndex) => {
          myAnswer = selectedIndex
          myAnsweredIndex = session.current_question_index

          render()

          try {
            await api.submitAnswer(
              sessionId,
              session.current_question_index,
              selectedIndex
            )
          } catch (err) {
            console.warn('[player] answer rejected:', err?.message || err)
          }
        },
      })
      break
    }

    case 'reveal': {
      // This is the branch most likely to have been silently stuck.
      // A reveal with zero answers is still valid data — only show a
      // loading message if the revealed question itself hasn't arrived yet.
      if (!revealedQuestion) {
        renderStatusMessage('Loading results…')
        return
      }

      const myAnswerForThisQuestion =
        myAnsweredIndex === session.current_question_index ? myAnswer : null

      renderFeedback(app, {
        question: revealedQuestion,
        correctIndex: revealedQuestion.correct_index,
        myAnswer: myAnswerForThisQuestion,
        scoreboard, // may be [] — that's a valid empty state, not a loading state
      })
      break
    }

    case 'ended':
      renderFinalScore(app, {
        scoreboard,
        myPlayerId: playerId,
        onPlayAgain: handlePlayAgain,
      })
      break

    default:
      console.warn('[player] unknown session status:', session.status)
      renderStatusMessage(`Unknown session status: ${session.status}`, { isError: true })
  }
}

function handlePlayAgain() {
  clearPlayerState()

  const urlCode = new URL(window.location.href).searchParams.get('code') || ''
  renderJoin(app, { prefillCode: urlCode, onJoin: handleJoin })
}

function clearPlayerState() {
  localStorage.removeItem('tq357_player_session_id')
  localStorage.removeItem('tq357_player_id')

  if (channel) {
    channel.unsubscribe()
    channel = null
  }

  if (expiryPoll) {
    clearInterval(expiryPoll)
    expiryPoll = null
  }

  sessionId = null
  playerId = null
  session = null
  myAnswer = null
  myAnsweredIndex = null
  scoreboard = []
  currentQuestion = null
  revealedQuestion = null
  rosterCount = 0
  resyncPromise = null
  resyncError = null
}

window.addEventListener('focus', () => {
  if (sessionId) {
    resyncPlayerState().catch((err) => {
      console.error('[player] focus resync failed:', err)
    })
  }
})

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && sessionId) {
    resyncPlayerState().catch((err) => {
      console.error('[player] visibility resync failed:', err)
    })
  }
})

boot()
