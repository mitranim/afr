// TODO: consider converting to TS.

export function main() {
  const url = new URL(import.meta.url)
  const clientKey = url.searchParams.get('key') || undefined
  const delay = 1024
  let req
  let timer

  reinit()

  function reinit() {
    deinit()
    req = new EventSource(new URL('events', url))
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

  function onDeinit() {scheduleReinit()}

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
    path = rootedPath(path)

    const prev = findSimilarStylesheets(path)
    if (!prev.length) return

    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = salted(path)

    link.onerror = link.remove
    link.onload = linkOnLoad
    last(prev).insertAdjacentElement('afterend', link)
  }

  function findSimilarStylesheets(pathname) {
    return [...document.head.querySelectorAll(`link[rel=stylesheet]`)].filter(node => (
      new URL(node.href).pathname === pathname
    ))
  }

  function linkOnLoad() {
    this.onerror = null
    this.onload = null

    const links = findSimilarStylesheets(new URL(this.href).pathname)
    for (const node of init(links)) node.remove()
  }

  function rootedPath(path) {
    path = path.replace(/^[/]*/g, '')
    return baseExists() ? path : `/${path}`
  }

  function baseExists() {
    const node = document.head.querySelector('base')
    return Boolean(node && node.href)
  }

  function salted(str) {return `${str}?${salt()}`}

  function salt() {
    return String(Math.random()).replace(/\d*\./, '').slice(0, 6)
  }

  function extName(path = '') {
    const match = path.match(/.([.][^.]+)$/)
    return !match ? '' : match[1]
  }

  function equiv(a, b) {
    return (a == null && b == null) || Object.is(a, b)
  }

  function init(list) {return list.slice(0, list.length - 1)}
  function last(list) {return list[list.length - 1]}
}
