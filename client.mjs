const url = new URL(import.meta.url)
const base = new URL('.', url)
const clientKey = url.searchParams.get('key') || undefined
const delay = 1024
let req
let timer

reinit()

function reinit() {
  deinit()
  req = new EventSource(`${base}events`)
  req.onmessage = onEventStreamMessage
  req.onerror = scheduleReinit
}

function scheduleReinit() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(reinit, delay)
}

function deinit() {
  if (req) {
    req.close()
    req = undefined
  }
  if (timer) clearTimeout(timer)
}

function onEventStreamMessage({data}) {
  onMessage(JSON.parse(data))
}

function onMessage(msg) {
  if (!msg) return

  const {type, key} = msg
  if (!equiv(key, clientKey)) return

  if (type === 'deinit') {
    onDeinit()
    return
  }

  if (type === 'change' || type === 'rename') {
    onChange(msg)
  }
}

function onDeinit() {
  scheduleReinit()
}

function onChange(msg) {
  const ext = extName(msg.path)

  if (ext === '.css') {
    onStylesheetChanged(msg)
    return
  }

  if (ext === '.map') {
    return
  }

  window.location.reload()
}

function onStylesheetChanged({path}) {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = rootedPath(path) + '?' + salt()

  const prev = Array.prototype.find.call(document.head.children, elem => (
    elem.tagName === 'LINK' && elem.rel === 'stylesheet' && samePathname(elem.href, link.href)
  ))

  if (!prev) return

  link.onload = prev.remove.bind(prev)
  link.onerror = link.remove.bind(link)
  prev.insertAdjacentElement('afterend', link)
}

function rootedPath(path) {
  if (baseHref()) return path
  if (path[0] === '/') return path
  return '/' + path
}

function baseHref() {
  const base = Array.prototype.find.call(document.head.children, isBase)
  return (base && base.href) || ''
}

function isBase(elem) {
  return elem.tagName === 'BASE'
}

function salt() {
  return String(Math.random()).replace(/\d*\./, '').slice(0, 6)
}

function samePathname(left, right) {
  left = left.replace(/[?].*/, '')
  right = right.replace(/[?].*/, '')
  return left === right
}

function extName(path = '') {
  const match = path.match(/.([.][^.]+)$/)
  return !match ? '' : match[1]
}

function equiv(a, b) {
  return (a == null && b == null) || Object.is(a, b)
}
