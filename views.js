export function renderJoin(container, { prefillCode, onJoin, error }) {
  container.innerHTML = `
    <div class="card">
      <h1>Trolley Quiz 357</h1>
      ${error ? `<p class="error">${error}</p>` : ''}
      <label>Join code
        <input id="code" value="${prefillCode || ''}" maxlength="6" autocapitalize="characters" />
      </label>
      <label>Your name
        <input id="name" maxlength="24" />
      </label>
      <button id="joinBtn">Join</button>
    </div>
  `
  container.querySelector('#joinBtn').addEventListener('click', () => {
    onJoin({
      code: container.querySelector('#code').value.trim(),
      name: container.querySelector('#name').value.trim(),
    })
  })
}

export function renderWaitingRoom(container, { rosterCount }) {
  container.innerHTML = `
    <div class="card">
      <h2>You're in!</h2>
      <p>Waiting for the host to start…</p>
      <p class="muted">${rosterCount} players in the room</p>
    </div>
  `
}

export function renderQuestionAnswer(container, { question, session, onSubmit, submitted }) {
  const deadline = new Date(session.question_started_at).getTime() + session.timer_seconds * 1000
  container.innerHTML = `
    <div class="card">
      <h2>Question ${session.current_question_index + 1} / ${session.question_count}</h2>
      <p class="prompt">${question.prompt}</p>
      <div id="countdown" class="countdown"></div>
      <div class="choices">
        ${question.choices
          .map((c, i) => `<button class="choiceBtn" data-i="${i}" ${submitted ? 'disabled' : ''}>${c}</button>`)
          .join('')}
      </div>
      <p id="status">${submitted ? 'Answer locked in — waiting for others…' : ''}</p>
    </div>
  `

  if (!submitted) {
    container.querySelectorAll('.choiceBtn').forEach((btn) => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.choiceBtn').forEach((b) => (b.disabled = true))
        container.querySelector('#status').textContent = 'Answer locked in — waiting for others…'
        onSubmit(Number(btn.dataset.i))
      })
    })
  }

  const countdownEl = container.querySelector('#countdown')
  const interval = setInterval(tick, 250)
  tick()
  function tick() {
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
    countdownEl.textContent = `${remaining}s`
    if (remaining <= 0) clearInterval(interval)
  }
}

export function renderFeedback(container, { question, correctIndex, myAnswer, scoreboard }) {
  const wasCorrect = myAnswer === correctIndex
  const headline = wasCorrect ? 'Correct!' : myAnswer == null ? 'No answer submitted' : 'Not quite'
  container.innerHTML = `
    <div class="card">
      <h2>${headline}</h2>
      <p class="prompt">${question.prompt}</p>
      <ul class="choices">
        ${question.choices
          .map(
            (c, i) =>
              `<li class="${i === correctIndex ? 'correct' : ''} ${i === myAnswer ? 'mine' : ''}">${c}</li>`
          )
          .join('')}
      </ul>
      <h3>Scoreboard</h3>
      <ol>${scoreboard.map((row) => `<li>${row.quiz_players.display_name} — ${row.total_score} pts</li>`).join('')}</ol>
      <p class="muted">Waiting for the host to continue…</p>
    </div>
  `
}

export function renderFinalScore(container, { scoreboard, myPlayerId, onPlayAgain }) {
  const rank = scoreboard.findIndex((row) => row.player_id === myPlayerId) + 1
  container.innerHTML = `
    <div class="card">
      <h1>Final Score</h1>
      <p>You placed #${rank} of ${scoreboard.length}</p>
      <ol>${scoreboard.map((row) => `<li>${row.quiz_players.display_name} — ${row.total_score} pts</li>`).join('')}</ol>
      <button id="againBtn">Play Again</button>
    </div>
  `
  container.querySelector('#againBtn').addEventListener('click', onPlayAgain)
}
