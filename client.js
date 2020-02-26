/* eslint-disable */

void function() {

wsReinit()

function wsReinit() {
  const url    = 'ws://' + window.location.host + '/afr/ws'
  const ws     = new WebSocket(url)
  ws.onmessage = wsOnMessage
  ws.onclose   = wsOnClose
}

function wsOnMessage(event) {
  onMessage(JSON.parse(event.data))
}

function wsOnClose() {
  setTimeout(wsReinit, 1000)
}

function onMessage(message) {
  if (message && message.type === 'changed') onChanged(message)
}

function onChanged(message) {
  if (message.fileType === 'stylesheet') {
    onStylesheetChanged(message)
    return
  }
  window.location.reload()
}

function onStylesheetChanged(message) {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = rootedPath(message.path) + '?' + salt()

  const prev = Array.prototype.find.call(document.head.children, elem => (
    elem.tagName === 'LINK' && elem.rel === 'stylesheet' && samePathname(elem.href, link.href)
  ))

  if (!prev) return

  link.onload = function() {removeNode(prev)}
  link.onerror = function() {removeNode(link)}
  prev.insertAdjacentElement('afterend', link)
}

function removeNode(node) {
  if (node && node.parentNode) node.parentNode.removeChild(node)
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

}()
