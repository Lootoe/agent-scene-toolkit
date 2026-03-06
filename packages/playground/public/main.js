const $ = id => document.getElementById(id)
const thread = $('thread')
thread.value = crypto.randomUUID()
$('newThread').onclick = () => (thread.value = crypto.randomUUID())

function addMsg(cls, text) {
  const d = document.createElement('div')
  d.className = cls
  d.textContent = text
  $('messages').appendChild(d)
  $('messages').scrollTop = 1e9
  return d
}

function addEvent(obj) {
  const d = document.createElement('div')
  d.className = 'event'
  d.innerHTML = `<div><b>${obj.type}</b> <span class="small">${new Date().toLocaleTimeString()}</span></div><pre class="small">${JSON.stringify(obj, null, 2)}</pre>`
  $('events').appendChild(d)
  $('events').scrollTop = 1e9
}

async function boot() {
  try {
    const [agents, scenes] = await Promise.all([
      fetch('/playground/api/agents').then(r => r.json()),
      fetch('/playground/api/scenes').then(r => r.json()),
    ])
    $('status').textContent = 'connected'
    $('status').style.color = '#22c55e'
    $('agents').innerHTML = agents.map(a => `<option>${a.name}</option>`).join('')
    $('scenes').innerHTML = '<option value="">(none)</option>' + scenes.map(s => `<option>${s.name}</option>`).join('')
  } catch {
    $('status').textContent = 'disconnected'
    $('status').style.color = '#ef4444'
  }
}

async function send() {
  const content = $('message').value.trim()
  if (!content) return
  $('message').value = ''
  addMsg('u', content)
  const ai = addMsg('a', '')

  const res = await fetch('/playground/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: content,
      threadId: thread.value,
      agentName: $('agents').value,
      sceneName: $('scenes').value,
    }),
  })

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const chunks = buf.split('\n\n')
    buf = chunks.pop()
    for (const c of chunks) {
      if (!c.startsWith('data: ')) continue
      const ev = JSON.parse(c.slice(6))
      addEvent(ev)
      if (ev.type === 'text') ai.textContent += ev.content
      if (ev.type === 'error') ai.textContent += `\n[ERROR] ${ev.message}`
    }
  }
}

$('send').onclick = send
$('message').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
})

boot()

