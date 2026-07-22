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
let scoreboard = []
let rosterCount = 0
let currentQuestion = null
let revealedQuestion = null
let myAnswer = null
let myAnsweredIndex = null
let channel = null
let expiryPoll = null
let resyncPromise = null

async function boot() {
  await ensureAnonymousSession()

  if (sessionId && playerId) {
    try {
      subscribe()
      await resyncSessionState()
      return
    } catch (err) {
      console.warn('Failed to restore saved player session:', err)
      clearPlayerSession()
    }
  }

  const urlCode = new URL(window.location.href).searchParams.get('code') || ''
  renderJoin(app, {
    prefillCode: urlCode,
    onJoin: handleJoin,
  })
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
    await resyncSessionState()
  } catch (err) {
    renderJoin(app, {
      prefillCode: code,
      onJoin: handleJoin,
      error: friendlyError(err),
    })
  }
}

function friendlyError(err) {
  if (err?.message?.includes('session_not_found')) {
    return 'That code was not found — double check with the host.'
  }

  if (err?.message?.includes('session_full')) {
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
    expiryPoll = setInterval(() => {
      if (session?.status === 'question_live') {
        api.tryAdvanceIfExpired(sessionId).catch((err) => {
          console.warn('tryAdvanceIfExpired failed:', err)
        })
      }
    }, 1000)
  }
}

async function handleBroadcast(payload) {
  const table = payload.table

  if (table === 'quiz_sessions') {
    session = payload.record
    await resyncSessionState()
    return
  }

  if (table === 'quiz_scores') {
    scoreboard = await api.fetchScoreboard(sessionId)
    render()
    return
  }

  if (table === 'quiz_players') {
    const roster = await api.fetchRoster(sessionId)
    rosterCount = roster.length
    render()
  }
}

async function resyncSessionState() {
  if (!sessionId) return
  if (resyncPromise) return resyncPromise

  resyncPromise = (async () => {
    session = await api.fetchSession(sessionId)

    currentQuestion = null
    revealedQuestion = null

    if (session.status === 'lobby') {
      const roster = await api.fetchRoster(sessionId)
      rosterCount = roster.length
      scoreboard = []
    } else if (session.status === 'question_live') {
      currentQuestion = await api.fetchCurrentQuestion(sessionId)
    } else if (session.status === 'reveal') {
      revealedQuestion = await api.fetchRevealedQuestion(sessionId)
      scoreboard = await api.fetchScoreboard(sessionId)
    } else if (session.status === 'ended') {
      scoreboard = await api.fetchScoreboard(sessionId)
    }

    render()
  })()

  try {
    await resyncPromise
  } finally {
    resyncPromise = null
  }
}

function render() {
  if (!session) {
    const urlCode = new URL(window.location.href).searchParams.get('code') || ''
    renderJoin(app, {
      prefillCode: urlCode,
      onJoin: handleJoin,
    })
    return
  }

  switch (session.status) {
    case 'lobby':
      renderWaitingRoom(app, {
        rosterCount,
      })
      break

    case 'question_live': {
      if (!currentQuestion) return

      const alreadySubmitted = myAnsweredIndex === session.current_question_index

      renderQuestionAnswer(app, {
        question: currentQuestion,
        session,
        submitted: alreadySubmitted,
        onSubmit: async (selectedIndex) => {
          if (myAnsweredIndex === session.current_question_index) return

          myAnswer = selectedIndex
          myAnsweredIndex = session.current_question_index
          render()

          try {
            await api.submitAnswer(sessionId, session.current_question_index, selectedIndex)
          } catch (err) {
            console.warn('answer rejected:', err?.message || err)
          }
        },
      })
      break
    }

    case 'reveal': {
      if (!revealedQuestion) return

      const myAnswerForThisQuestion =
        myAnsweredIndex === session.current_question_index ? myAnswer : null

      renderFeedback(app, {
        question: revealedQuestion,
        correctIndex: revealedQuestion.correct_index,
        myAnswer: myAnswerForThisQuestion,
        scoreboard,
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
      console.warn('Unknown player session status:', session.status)
  }
}

function handlePlayAgain() {
  clearPlayerSession()
  const urlCode = new URL(window.location.href).searchParams.get('code') || ''
  renderJoin(app, {
    prefillCode: urlCode,
    onJoin: handleJoin,
  })
}

function clearPlayerSession() {
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
  scoreboard = []
  rosterCount = 0
  currentQuestion = null
  revealedQuestion = null
  myAnswer = null
  myAnsweredIndex = null
  resyncPromise = null
}

window.addEventListener('focus', () => {
  if (sessionId) {
    resyncSessionState().catch((err) => {
      console.error('Player focus resync failed:', err)
    })
  }
})

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && sessionId) {
    resyncSessionState().catch((err) => {
      console.error('Player visibility resync failed:', err)
    })
  }
})

boot()
