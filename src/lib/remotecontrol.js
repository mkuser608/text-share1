/**
 * Remote control of a shared screen.
 *
 * Viewer side: capture pointer/keyboard on the <video> showing the remote
 * screen, normalize to 0..1 coordinates, send over the ctl DataChannel.
 *
 * Sharer side: replay events as synthetic DOM events on this page.
 * Browser reality check: pages can only inject events into THEMSELVES, so
 * control works when the sharer shares *this app's tab*. Other windows /
 * the OS cannot be controlled from a web page.
 */

// ---------------- sharer side ----------------
let cursorEl = null

function ensureCursor(name) {
  if (!cursorEl) {
    cursorEl = document.createElement('div')
    cursorEl.style.cssText =
      'position:fixed;z-index:999999;pointer-events:none;transition:transform .04s linear;top:0;left:0'
    cursorEl.innerHTML =
      `<svg width="20" height="20" viewBox="0 0 24 24" fill="#f43f5e" stroke="white" stroke-width="1.5"><path d="M3 2l7 19 2.5-7.5L20 11z"/></svg>` +
      `<span style="background:#f43f5e;color:#fff;font:600 10px sans-serif;padding:2px 6px;border-radius:8px;margin-left:2px;white-space:nowrap"></span>`
    document.body.appendChild(cursorEl)
  }
  cursorEl.querySelector('span').textContent = name || 'remote'
  return cursorEl
}

export function removeRemoteCursor() {
  cursorEl?.remove()
  cursorEl = null
}

function elAt(x, y) { return document.elementFromPoint(x, y) || document.body }

function fire(el, type, Ctor, init) {
  el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, view: window, ...init }))
}

function isEditable(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

/** Apply one remote-control message on the sharer's page. */
export function applyRemoteEvent(msg, senderName) {
  const x = msg.x * window.innerWidth
  const y = msg.y * window.innerHeight

  switch (msg.t) {
    case 'rc-move': {
      const c = ensureCursor(senderName)
      c.style.transform = `translate(${x}px, ${y}px)`
      fire(elAt(x, y), 'pointermove', PointerEvent, { clientX: x, clientY: y })
      break
    }
    case 'rc-click': {
      const el = elAt(x, y)
      const init = { clientX: x, clientY: y, button: msg.button || 0 }
      fire(el, 'pointerdown', PointerEvent, init)
      fire(el, 'mousedown', MouseEvent, init)
      if (typeof el.focus === 'function') el.focus()
      fire(el, 'pointerup', PointerEvent, init)
      fire(el, 'mouseup', MouseEvent, init)
      fire(el, 'click', MouseEvent, init)
      break
    }
    case 'rc-wheel': {
      let el = elAt(x, y)
      while (el && el !== document.body) {
        const s = getComputedStyle(el)
        if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight) {
          el.scrollTop += msg.dy
          return
        }
        el = el.parentElement
      }
      window.scrollBy(0, msg.dy)
      break
    }
    case 'rc-key': {
      const ae = document.activeElement
      const init = { key: msg.key, code: msg.code, ctrlKey: msg.ctrl, shiftKey: msg.shift, altKey: msg.alt, metaKey: msg.meta }
      fire(ae || document.body, 'keydown', KeyboardEvent, init)
      if (isEditable(ae) && !msg.ctrl && !msg.meta) {
        if (msg.key.length === 1) document.execCommand('insertText', false, msg.key)
        else if (msg.key === 'Enter') document.execCommand('insertText', false, '\n')
        else if (msg.key === 'Backspace') document.execCommand('delete')
      }
      fire(ae || document.body, 'keyup', KeyboardEvent, init)
      break
    }
  }
}

// ---------------- viewer side ----------------

/**
 * Attach control capture to a <video> element showing the remote screen.
 * Coordinates are normalized against the actual video content box
 * (compensating for object-fit:contain letterboxing).
 * Returns a detach() function.
 */
export function attachViewerControls(video, send) {
  const norm = (e) => {
    const r = video.getBoundingClientRect()
    const vw = video.videoWidth || r.width
    const vh = video.videoHeight || r.height
    const va = vw / vh
    const ea = r.width / r.height
    let w, h, ox, oy
    if (ea > va) { h = r.height; w = h * va; ox = (r.width - w) / 2; oy = 0 }
    else { w = r.width; h = w / va; ox = 0; oy = (r.height - h) / 2 }
    const x = (e.clientX - r.left - ox) / w
    const y = (e.clientY - r.top - oy) / h
    if (x < 0 || x > 1 || y < 0 || y > 1) return null
    return { x: +x.toFixed(4), y: +y.toFixed(4) }
  }

  let last = 0
  const onMove = (e) => {
    const now = performance.now()
    if (now - last < 33) return // ~30 msgs/s
    last = now
    const p = norm(e)
    if (p) send({ t: 'rc-move', ...p })
  }
  const onClick = (e) => {
    const p = norm(e)
    if (p) send({ t: 'rc-click', ...p, button: e.button })
    video.focus()
    e.preventDefault()
  }
  const onWheel = (e) => {
    const p = norm(e)
    if (p) send({ t: 'rc-wheel', ...p, dy: e.deltaY })
    e.preventDefault()
  }
  const onKey = (e) => {
    send({ t: 'rc-key', x: 0, y: 0, key: e.key, code: e.code, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey })
    e.preventDefault()
  }

  video.tabIndex = 0
  video.style.cursor = 'crosshair'
  video.addEventListener('pointermove', onMove)
  video.addEventListener('pointerdown', onClick)
  video.addEventListener('wheel', onWheel, { passive: false })
  video.addEventListener('keydown', onKey)

  return () => {
    video.style.cursor = ''
    video.removeEventListener('pointermove', onMove)
    video.removeEventListener('pointerdown', onClick)
    video.removeEventListener('wheel', onWheel)
    video.removeEventListener('keydown', onKey)
  }
}

/**
 * Full-PC control capture (viewer side). Like attachViewerControls, but emits
 * events destined for a NATIVE AGENT that injects them into the host's OS.
 * Coordinates are normalized 0..1 against the shared *entire screen* video.
 * `send` delivers each event to the agent (over the WebSocket relay).
 * Returns detach().
 */
export function attachFullControl(video, send) {
  const norm = (e) => {
    const r = video.getBoundingClientRect()
    const vw = video.videoWidth || r.width
    const vh = video.videoHeight || r.height
    const va = vw / vh, ea = r.width / r.height
    let w, h, ox, oy
    if (ea > va) { h = r.height; w = h * va; ox = (r.width - w) / 2; oy = 0 }
    else { w = r.width; h = w / va; ox = 0; oy = (r.height - h) / 2 }
    const x = (e.clientX - r.left - ox) / w
    const y = (e.clientY - r.top - oy) / h
    if (x < 0 || x > 1 || y < 0 || y > 1) return null
    return { x: +x.toFixed(4), y: +y.toFixed(4) }
  }

  let last = 0
  const onMove = (e) => {
    const now = performance.now()
    if (now - last < 25) return
    last = now
    const p = norm(e); if (p) send({ t: 'rc-move', ...p })
  }
  const onDown = (e) => { const p = norm(e); if (p) send({ t: 'rc-down', ...p, button: e.button }); video.focus(); e.preventDefault() }
  const onUp = (e) => { send({ t: 'rc-up', button: e.button }); e.preventDefault() }
  const onDbl = (e) => { const p = norm(e); if (p) send({ t: 'rc-dblclick', ...p, button: e.button }); e.preventDefault() }
  const onCtx = (e) => e.preventDefault()
  const onWheel = (e) => { send({ t: 'rc-wheel', dy: e.deltaY }); e.preventDefault() }
  const onKey = (e) => {
    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
    if (printable) send({ t: 'rc-text', text: e.key })
    else send({ t: 'rc-combo', key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey })
    e.preventDefault()
  }

  video.tabIndex = 0
  video.style.cursor = 'crosshair'
  video.addEventListener('pointermove', onMove)
  video.addEventListener('pointerdown', onDown)
  video.addEventListener('pointerup', onUp)
  video.addEventListener('dblclick', onDbl)
  video.addEventListener('contextmenu', onCtx)
  video.addEventListener('wheel', onWheel, { passive: false })
  video.addEventListener('keydown', onKey)

  return () => {
    video.style.cursor = ''
    video.removeEventListener('pointermove', onMove)
    video.removeEventListener('pointerdown', onDown)
    video.removeEventListener('pointerup', onUp)
    video.removeEventListener('dblclick', onDbl)
    video.removeEventListener('contextmenu', onCtx)
    video.removeEventListener('wheel', onWheel)
    video.removeEventListener('keydown', onKey)
  }
}
