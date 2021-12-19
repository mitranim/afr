export function main() {
  const url = new URL(import.meta.url)
  const clientKey = url.searchParams.get(`key`) || undefined
  const delay = 1024

  let req
  let timer
  let remAttempts

  reinit()

  function reinit() {
    deinit()
    req = new EventSource(new URL(`events`, url))

    // Only works in Chrome.
    req.onopen = onEventSourceOpen

    req.onmessage = onEventSourceMessage
    req.onerror = onEventSourceError
  }

  function deinit() {
    if (timer) clearTimeout(timer)
    timer = undefined

    try {req?.close()}
    finally {req = undefined}
  }

  function onEventSourceOpen() {remAttempts = 8}

  function onEventSourceError() {
    deinit()

    /*
    Why limited attempts: because when the server is down, we want to eventually
    give up and stop using CPU. Note that we don't want exponential backoff. It
    should either reconnect immediately, or not bother reconnecting.
    Reconnecting after a large delay is pointless, because the user would have
    already reloaded manually.

    Why attempts may be null: because only Chrome fires `onopen`.

    Why attempts are reset only on `onopen`: seems to be the only way that makes
    sense. We can't reset attempts on each attempt, and when the browser
    doesn't support `onopen`, we don't want to use a limited global counter
    that only ever goes down.
    */
    if (remAttempts == null || remAttempts-- > 0) {
      timer = setTimeout(reinit, delay)
    }
  }

  function onEventSourceMessage({data}) {
    onMessage(JSON.parse(data || `null`))
  }

  function onMessage(msg) {
    if (!msg) return
    const {type, key} = msg

    if (!equiv(key, clientKey)) return
    if (type === `deinit`) {onDeinit(); return}
    if (type === `change` || type === `rename`) onChange(msg)
  }

  function onDeinit() {deinit()}

  function onChange(msg) {
    const ext = extName(msg.path)

    if (ext === `.css`) {
      onStylesheetChanged(msg)
      return
    }

    if (ext === `.map`) {
      return
    }

    window.location.reload()
  }

  function onStylesheetChanged({path}) {
    if (!path) return
    path = rootedPath(path)

    const prev = findSimilarStylesheets(path)
    if (!prev.length) return

    const link = document.createElement(`link`)
    link.rel = `stylesheet`
    link.href = salted(path)

    link.onerror = link.remove
    link.onload = linkOnLoad
    last(prev).insertAdjacentElement(`afterend`, link)
  }

  function findSimilarStylesheets(pathname) {
    return filter(
      document.head.querySelectorAll(`link[rel=stylesheet]`),
      node => new URL(node.href).pathname === pathname,
    )
  }

  function linkOnLoad() {
    this.onerror = null
    this.onload = null

    const links = findSimilarStylesheets(new URL(this.href).pathname)
    for (const node of init(links)) node.remove()
  }

  function rootedPath(path) {
    path = path.replace(/^[/]*/g, ``)
    return baseExists() ? path : `/${path}`
  }

  function baseExists() {
    const node = document.head.querySelector(`base`)
    return Boolean(node && node.href)
  }

  function salted(str) {return `${str}?${salt()}`}

  function salt() {
    return String(Math.random()).replace(/\d*\./, ``).slice(0, 6)
  }

  function extName(path = ``) {
    const match = path.match(/.([.][^.]+)$/)
    return !match ? `` : match[1]
  }

  function equiv(a, b) {
    return (a == null && b == null) || Object.is(a, b)
  }

  function init(list) {return list.slice(0, list.length - 1)}
  function last(list) {return list[list.length - 1]}
  function filter(list, fun) {return Array.prototype.filter.call(list ?? [], fun)}
}
