/* ─── Lilo Playground ──────────────────────────────── */
const $ = id => document.getElementById(id)
const thread = $('thread')
thread.value = crypto.randomUUID().slice(0, 8)
let sending = false
let activeFilters = new Set()
const TYPES = ['text','tool_start','tool_end','handoff','agent','error','done']

// ─── Boot ─────────────────────────────────────────────
async function boot() {
  try {
    const [agents, scenes, config] = await Promise.all([
      fetch('/playground/api/agents').then(r => r.json()),
      fetch('/playground/api/scenes').then(r => r.json()),
      fetch('/playground/api/config').then(r => r.json()),
    ])
    $('statusDot').classList.add('ok')
    $('statusText').textContent = 'connected'
    $('configInfo').textContent = config.model + ' @ ' + config.baseURL
    $('agents').innerHTML = agents.map(a => '<option value="' + a.name + '">' + a.name + ' (' + a.model + ')</option>').join('')
    $('scenes').innerHTML = '<option value="">(none)</option>' + scenes.map(s => '<option value="' + s.name + '">' + s.name + '</option>').join('')
  } catch { $('statusText').textContent = 'disconnected' }
  TYPES.forEach(t => {
    const tag = document.createElement('span')
    tag.className = 'filter-tag active'
    tag.textContent = t
    tag.onclick = () => { tag.classList.toggle('active'); if (tag.classList.contains('active')) activeFilters.delete(t); else activeFilters.add(t); applyFilters() }
    $('filterBar').appendChild(tag)
  })
}
function applyFilters() { document.querySelectorAll('.ev-item').forEach(el => { el.style.display = activeFilters.size && activeFilters.has(el.dataset.type) ? 'none' : '' }) }

// ─── Session ──────────────────────────────────────────
$('newThread').onclick = () => { thread.value = crypto.randomUUID().slice(0, 8); $('messages').innerHTML = '' }
$('clearLog').onclick = () => { $('events').innerHTML = '' }

// ─── Event Log ────────────────────────────────────────
function addEvent(ev) {
  const item = document.createElement('div')
  item.className = 'ev-item'
  item.dataset.type = ev.type
  if (activeFilters.size && activeFilters.has(ev.type)) item.style.display = 'none'
  const ts = new Date().toLocaleTimeString('en', { hour12: false, fractionalSecondDigits: 3 })
  item.innerHTML = '<div class="ev-head"><span class="ev-tag ' + ev.type + '">' + ev.type + '</span><span class="ev-time">' + ts + '</span></div><div class="ev-body"><pre class="ev-json">' + JSON.stringify(ev, null, 2) + '</pre></div>'
  item.querySelector('.ev-head').onclick = () => item.classList.toggle('open')
  $('events').appendChild(item)
  $('events').scrollTop = $('events').scrollHeight
}

// ─── Chat UI Helpers ──────────────────────────────────
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML }
function scrollChat() { $('messages').scrollTop = $('messages').scrollHeight }

function addUserMsg(text) {
  const d = document.createElement('div')
  d.className = 'msg-user'
  d.innerHTML = '<div class="msg-user-bubble">' + esc(text) + '</div>'
  $('messages').appendChild(d)
  scrollChat()
}

function createAiGroup() {
  const g = document.createElement('div')
  g.className = 'msg-ai-group'
  g.innerHTML = '<div class="msg-ai-label">Agent</div>'
  $('messages').appendChild(g)
  return g
}

function addThinking(group) {
  const d = document.createElement('div')
  d.className = 'thinking'
  d.innerHTML = '<div class="thinking-dots"><span></span><span></span><span></span></div><span>Thinking...</span>'
  group.appendChild(d)
  scrollChat()
  return d
}

function addToolCard(group, toolName, input) {
  const card = document.createElement('div')
  card.className = 'tool-card running'
  card.innerHTML = '<div class="tool-header"><span class="tool-icon">&#128295;</span><span class="tool-name">' + esc(toolName) + '</span><span class="tool-status">running...</span><span class="tool-chevron">&#9654;</span></div>' +
    '<div class="tool-body"><div class="tool-section-label">INPUT</div><pre class="tool-json">' + JSON.stringify(input, null, 2) + '</pre>' +
    '<div class="tool-section-label" style="display:none">OUTPUT</div><pre class="tool-json" style="display:none"></pre></div>'
  card.querySelector('.tool-header').onclick = () => card.classList.toggle('open')
  group.appendChild(card)
  scrollChat()
  return card
}

function completeToolCard(card, output) {
  card.classList.remove('running')
  card.classList.add('done')
  card.querySelector('.tool-icon').textContent = '\u2705'
  card.querySelector('.tool-status').textContent = 'done'
  const labels = card.querySelectorAll('.tool-section-label')
  const pres = card.querySelectorAll('.tool-json')
  if (labels[1]) labels[1].style.display = ''
  if (pres[1]) { pres[1].style.display = ''; pres[1].textContent = typeof output === 'string' ? output : JSON.stringify(output, null, 2) }
}

function getOrCreateTextBlock(group) {
  const last = group.lastElementChild
  if (last && last.classList.contains('msg-ai-content')) return last
  const d = document.createElement('div')
  d.className = 'msg-ai-content'
  group.appendChild(d)
  return d
}

function addHandoff(from, to) {
  const d = document.createElement('div')
  d.className = 'msg-handoff'
  d.textContent = from + ' \u2192 ' + to
  $('messages').appendChild(d)
  scrollChat()
}

function addErrorMsg(msg) {
  const d = document.createElement('div')
  d.className = 'msg-error'
  d.textContent = msg
  $('messages').appendChild(d)
  scrollChat()
}

// ─── Send & SSE Stream ───────────────────────────────
async function send() {
  const text = $('message').value.trim()
  if (!text || sending) return
  $('message').value = ''
  $('message').style.height = 'auto'
  sending = true
  $('send').disabled = true
  addUserMsg(text)
  const group = createAiGroup()
  const thinkingEl = addThinking(group)
  let currentToolCard = null
  let hasContent = false
  try {
    const res = await fetch('/playground/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: text, threadId: thread.value, agentName: $('agents').value, sceneName: $('scenes').value, sceneContext: parseCtx() }),
    })
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const parts = buf.split('\n\n')
      buf = parts.pop()
      for (const p of parts) {
        if (!p.startsWith('data: ')) continue
        let ev
        try { ev = JSON.parse(p.slice(6)) } catch { continue }
        addEvent(ev)
        switch (ev.type) {
          case 'text':
            if (!hasContent) { thinkingEl.remove(); hasContent = true }
            getOrCreateTextBlock(group).textContent += ev.content
            scrollChat()
            break
          case 'tool_start':
            if (!hasContent) { thinkingEl.remove(); hasContent = true }
            currentToolCard = addToolCard(group, ev.toolName, ev.input)
            break
          case 'tool_end':
            if (currentToolCard) { completeToolCard(currentToolCard, ev.output); currentToolCard = null }
            break
          case 'agent':
            group.querySelector('.msg-ai-label').textContent = ev.name
            break
          case 'handoff':
            addHandoff(ev.from, ev.to)
            break
          case 'error':
            if (!hasContent) thinkingEl.remove()
            addErrorMsg(ev.message)
            break
          case 'done':
            if (!hasContent) thinkingEl.remove()
            break
        }
      }
    }
  } catch (err) {
    if (!hasContent) thinkingEl.remove()
    addErrorMsg('Connection error: ' + err.message)
  } finally {
    sending = false
    $('send').disabled = false
    $('message').focus()
  }
}

function parseCtx() {
  const raw = $('sceneCtx').value.trim()
  if (!raw) return undefined
  try { return JSON.parse(raw) } catch { return undefined }
}

// ─── Event Listeners ─────────────────────────────────
$('send').onclick = send
$('message').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } })
$('message').addEventListener('input', function () { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 120) + 'px' })
boot()