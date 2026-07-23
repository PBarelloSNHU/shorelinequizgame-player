// main.js — Shoreline Quiz Game Player
import * as api from './api.js'
import { joinSessionChannel } from './realtimeChannel.js'
import { ensureAnonymousSession } from './supabaseClient.js'

const state = {
  isLoading: true,
  loadError: null,
  session: null,        // { status, currentQuestionIndex, timerSeconds, questionStartedAt }
  playerId: null,
  rosterCount: 0,
  scoreboard: [],
  currentQuestion: null,   // { order_index, prompt, choices, timer_seconds, question_started_at }
  revealedQuestion: null,  // { order_index, prompt, choices, correct_index }
  myAnsweredIndex: null,
  myLastCorrect: null,
}

const rootEl = document.getElementById('app')
let channel = null
let resyncPromise = null
let pollTimer = null
let timerInterval = null
let resyncFailureCount = 0
const MAX_RESYNC_FAILURES = 3

// ---------- Render ----------

function render() {
  console.log('[player] render status:', state.session?.status ?? 'none', {
    isLoading: state.isLoading,
    hasCurrentQuestion: !!state.currentQuestion,
    hasRevealedQuestion: !!state.revealedQuestion,
    loadError: state.loadError,
  })

  if (state.isLoading) {
    rootEl.innerHTML = renderLoading()
    return
  }
  if (state.loadError) {
    rootEl.innerHTML = renderError(state.loadError)
    wireRetry()
    return
  }
  if (!state.session) {
    rootEl.innerHTML = renderJoinScreen()
    wireJoin()
    return
  }

  switch (state.session.status) {
    case 'lobby':
      rootEl.innerHTML = renderLobby()
      stopTimer()
      break
    case 'question_live':
      rootEl.innerHTML = renderQuestion()
      wireAnswerButtons()
      startTimer(state.currentQuestion)
      break
    case 'reveal':
      rootEl.innerHTML = renderReveal()
      stopTimer()
      break
    case 'ended':
      rootEl.innerHTML = renderScoreboard()
      wireRejoin()
      stopTimer()
      break
    default:
      rootEl.innerHTML = renderUnknownStatus(state.session.status)
      stopTimer()
  }
}

function renderLoading() {
  return `<div class="player-loading">Having trouble loading this question. Retrying…</div>`
}

function renderError(message) {
  return `
    <div class="player-error">
      <p>${escapeHtml(message)}</p>
      <button id="retry-btn">Retry</button>
    </div>
  `
}

function renderJoinScreen(prefillCode = '', errorMsg = '') {
  const urlCode = new URL(window.location.href).searchParams.get('code') || prefillCode
  return `
    <div class="player-join">
      <h1>Join Quiz</h1>
      ${errorMsg ? `<p class="join-error">${escapeHtml(errorMsg)}</p>` : ''}
      <label>Join code
        <input id="join-code" type="text" maxlength="6" value="${escapeHtml(urlCode)}" placeholder="ABC123" />
      </label>
      <label>Your name
        <input id="join-name" type="text" maxlength="24" placeholder="Enter your name" />
      </label>
      <button id="join-btn">Join</button>
    </div>
  `
}

function renderUnknownStatus(status) {
  return `<div class="player-error">Unknown session status: ${escapeHtml(String(status))}</div>`
}

function renderLobby() {
  return `
    <section class="player-lobby">
      <h1>Waiting for the host to start…</h1>
      <p>${state.rosterCount} player(s) in the room</p>
    </section>
  `
}

function renderQuestion() {
  const q = state.currentQuestion
  if (!q) {
    return `<div class="player-error">Question data is unavailable. <button id="retry-btn">Retry</button></div>`
  }
  const choices = Array.isArray(q.choices) ? q.choices : []
  const submitted = state.myAnsweredIndex !== null

  const choicesMarkup = choices
    .map(
      (choice, i) => `
        <button class="choice-btn" data-index="${i}" ${submitted ? 'disabled' : ''}
          ${state.myAnsweredIndex === i ? 'data-selected="true"' : ''}>
          ${escapeHtml(String(choice))}
        </button>
      `
    )
    .join('')

  return `
    <section class="player-question">
      <div class="timer-display" id="player-timer">--</div>
      <h1>Question ${(q.order_index ?? 0) + 1}</h1>
      <p>${escapeHtml(q.prompt)}</p>
      <div class="choices">${choicesMarkup}</div>
      ${submitted ? '<p class="answer-locked">Answer locked in — waiting for others…</p>' : ''}
    </section>
  `
}

function renderReveal() {
  const q = state.revealedQuestion
  if (!q) {
    return `<div class="player-error">Question data is unavailable. <button id="retry-btn">Retry</button></div>`
  }
  const choices = Array.isArray(q.choices) ? q.choices : []
  const choicesMarkup = choices
    .map((choice, i) => {
      const isCorrect = i === q.correct_index
      const isMine = i === state.myAnsweredIndex
      return `
        <div class="reveal-choice ${isCorrect ? 'correct' : ''} ${isMine ? 'mine' : ''}">
          ${escapeHtml(String(choice))} ${isCorrect ? '✓' : ''} ${isMine && !isCorrect ? '(your answer)' : ''}
        </div>
      `
    })
    .join('')

  const resultMarkup =
    state.myAnsweredIndex === null
      ? '<p>You did not answer this question.</p>'
      : `<p>${state.myLastCorrect ? 'Correct!' : 'Incorrect.'}</p>`

  return `
    <section class="player-reveal">
      <h1>Answer Revealed</h1>
      <p>${escapeHtml(q.prompt)}</p>
      <div class="reveal-choices">${choicesMarkup}</div>
      ${resultMarkup}
      <p>Waiting for the host to continue…</p>
    </section>
  `
}

function renderScoreboard() {
  const sorted = [...state.scoreboard].sort((a, b) => b.total_score - a.total_score)
  const myRank = sorted.findIndex((row) => row.player_id === state.playerId) + 1

  const rows = sorted
    .map(
      (row, i) => `
        <li class="${row.player_id === state.playerId ? 'me' : ''}">
          ${i + 1}. ${escapeHtml(row.quiz_players?.display_name ?? 'Player')} —
          ${row.total_score} pts (${row.correct_count} correct)
        </li>
      `
    )
    .join('')

  return `
    <section class="player-scoreboard">
      <h1>Final Scoreboard</h1>
      ${myRank > 0 ? `<p>You placed #${myRank} of ${sorted.length}</p>` : ''}
      <ol>${rows || '<li>No scores recorded.</li>'}</ol>
      <button id="rejoin-btn">Join Another Quiz</button>
    </section>
  `
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// ---------- Timer ----------

function startTimer(question) {
  stopTimer()
  if (!question?.question_started_at || !question?.timer_seconds) return

  const startedAt = new Date(question.question_started_at).getTime()
  const totalMs = question.timer_seconds * 1000
  const sessionId = getSessionIdFromState()

  const tick = () => {
    const el = document.getElementById('player-timer')
    if (!el) {
      stopTimer()
      return
    }
    const remainingMs = Math.max(0, startedAt + totalMs - Date.now())
    const remainingSec = Math.ceil(remainingMs / 1000)
    el.textContent = `${remainingSec}s`
    el.classList.toggle('timer-low', remainingSec <= 5)

    if (remainingMs <= 0) {
      stopTimer()
      api.tryAdvanceIfExpired(sessionId).catch(() => {})
      resyncPlayerState()
    }
  }

  tick()
  timerInterval = setInterval(tick, 250)
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval)
    timerInterval = null
  }
}

// ---------- Event wiring ----------

function wireRetry() {
  document.getElementById('retry-btn')?.addEventListener('click', () => {
    if (state.playerId && getSessionIdFromState()) {
      resyncFailureCount = 0
      resyncPlayerState()
    } else {
      clearPlayerState()
      state.isLoading = false
      state.loadError = null
      render()
    }
  })
}

function wireJoin() {
  document.getElementById('join-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget
    btn.disabled = true
    const code = document.getElementById('join-code').value.trim()
    const name = document.getElementById('join-name').value.trim()

    if (!code || !name) {
      rootEl.innerHTML = renderJoinScreen(code, 'Please enter both a join code and your name.')
      wireJoin()
      btn.disabled = false
      return
    }

    try {
      await ensureAnonymousSession()
      const result = await api.joinSession({ code, name })
      savePlayerState({ sessionId: result.session_id, playerId: result.player_id })
      state.playerId = result.player_id
      await bootSession(result.session_id)
    } catch (err) {
      console.error('[player] failed to join session', err)
      rootEl.innerHTML = renderJoinScreen(code, err.message ?? 'Unable to join. Check the code and try again.')
      wireJoin()
    } finally {
      btn.disabled = false
    }
  })
}

function wireAnswerButtons() {
  document.querySelectorAll('.choice-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (state.myAnsweredIndex !== null) return
      const index = Number(btn.dataset.index)
      const sessionId = getSessionIdFromState()
      const orderIndex = state.currentQuestion?.order_index ?? state.session.currentQuestionIndex

      document.querySelectorAll('.choice-btn').forEach((b) => (b.disabled = true))
      state.myAnsweredIndex = index
      render()
      startTimer(state.currentQuestion)

      try {
        const isCorrect = await api.submitAnswer(sessionId, orderIndex, index)
        state.myLastCorrect = isCorrect
      } catch (err) {
        console.error('[player] failed to submit answer', err)
        state.myAnsweredIndex = null
        render()
        startTimer(state.currentQuestion)
      }
    })
  })
}

function wireRejoin() {
  document.getElementById('rejoin-btn')?.addEventListener('click', () => {
    clearPlayerState()
    if (channel) {
      channel.unsubscribe()
      channel = null
    }
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    stopTimer()
    state.isLoading = false
    state.loadError = null
    state.session = null
    state.playerId = null
    render()
  })
}

// ---------- Local persisted state ----------

function savePlayerState({ sessionId, playerId }) {
  try {
    localStorage.setItem('tq357_session_id', sessionId)
    localStorage.setItem('tq357_player_id', playerId)
  } catch (_) {
    // localStorage may be unavailable in sandboxed contexts; state still
    // works for the current tab session via in-memory variables.
  }
}

function loadPlayerState() {
  try {
    return {
      sessionId: localStorage.getItem('tq357_session_id'),
      playerId: localStorage.getItem('tq357_player_id'),
    }
  } catch (_) {
    return { sessionId: null, playerId: null }
  }
}

function clearPlayerState() {
  try {
    localStorage.removeItem('tq357_session_id')
    localStorage.removeItem('tq357_player_id')
  } catch (_) {
    // no-op
  }
}

function getSessionIdFromState() {
  return loadPlayerState().sessionId
}

// ---------- Data resync ----------

async function resyncPlayerState() {
  const sessionId = getSessionIdFromState()
  if (!sessionId) return
  if (resyncPromise) return resyncPromise

  resyncPromise = (async () => {
    try {
      const rawSession = await api.fetchSession(sessionId)

      state.session = {
        status: rawSession.status,
        currentQuestionIndex: rawSession.current_question_index ?? 0,
        timerSeconds: rawSession.timer_seconds,
        questionStartedAt: rawSession.question_started_at,
      }

      state.currentQuestion = null
      state.revealedQuestion = null

      if (rawSession.status === 'lobby') {
        const roster = await api.fetchRoster(sessionId)
        state.rosterCount = roster.length
        state.myAnsweredIndex = null
        state.myLastCorrect = null
      } else if (rawSession.status === 'question_live') {
        state.currentQuestion = await api.fetchCurrentQuestion(sessionId)
        if (!state.currentQuestion) throw new Error('fetchCurrentQuestion returned no data')
      } else if (rawSession.status === 'reveal') {
        state.revealedQuestion = await api.fetchRevealedQuestion(sessionId)
        if (!state.revealedQuestion) throw new Error('fetchRevealedQuestion returned no data')
      } else if (rawSession.status === 'ended') {
        state.scoreboard = await api.fetchScoreboard(sessionId)
      }

      state.isLoading = false
      state.loadError = null
      resyncFailureCount = 0
    } catch (err) {
      console.error('[player] failed to load state for status', state.session?.status, err)
      resyncFailureCount += 1

      if (resyncFailureCount >= MAX_RESYNC_FAILURES) {
        console.warn('[player] giving up on broken session, clearing local state')
        clearPlayerState()
        if (channel) {
          channel.unsubscribe()
          channel = null
        }
        if (pollTimer) {
          clearInterval(pollTimer)
          pollTimer = null
        }
        stopTimer()
        state.isLoading = false
        state.loadError = null
        state.session = null
        state.playerId = null
        rootEl.innerHTML = renderJoinScreen('', 'Your session ended or is no longer valid. Please rejoin with the code.')
        wireJoin()
        return
      }

      state.isLoading = false
      state.loadError = null // keep showing last known view rather than a hard error, unless failures exceed threshold
    }

    console.log('[player] resynced player state:', {
      status: state.session?.status,
      rosterCount: state.rosterCount,
      currentQuestionIndex: state.session?.currentQuestionIndex,
      scoreboardCount: state.scoreboard.length,
      myAnsweredIndex: state.myAnsweredIndex,
      resyncFailureCount,
    })

    render()
  })()

  try {
    await resyncPromise
  } finally {
    resyncPromise = null
  }
}

// ---------- Boot ----------

async function bootSession(sessionId) {
  state.isLoading = true
  state.loadError = null
  render()

  if (channel) {
    channel.unsubscribe()
    channel = null
  }
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  stopTimer()

  await resyncPlayerState()

  channel = joinSessionChannel(sessionId, {
    presenceKey: state.playerId ?? 'player',
    presencePayload: { playerId: state.playerId },
    onChange: () => {
      // A new question means the previous answer no longer applies.
      state.myAnsweredIndex = null
      state.myLastCorrect = null
      resyncPlayerState()
    },
    onPresenceSync: (presenceState) => {
      state.rosterCount = Object.keys(presenceState).length || state.rosterCount
      if (state.session?.status === 'lobby') render()
    },
  })

  pollTimer = setInterval(() => {
    api.tryAdvanceIfExpired(sessionId).catch(() => {})
    resyncPlayerState()
  }, 5000)

  window.addEventListener('beforeunload', () => {
    if (channel) channel.unsubscribe()
    if (pollTimer) clearInterval(pollTimer)
    stopTimer()
  })
}

async function boot() {
  const { sessionId, playerId } = loadPlayerState()

  if (!sessionId || !playerId) {
    state.isLoading = false
    state.loadError = null
    state.session = null
    render()
    return
  }

  try {
    await ensureAnonymousSession()
    state.playerId = playerId
    await bootSession(sessionId)
  } catch (err) {
    console.error('[player] failed to resume session', err)
    clearPlayerState()
    state.isLoading = false
    state.loadError = null
    state.session = null
    state.playerId = null
    render()
  }
}

boot()

export { render, state }
