#!/usr/bin/env -S deno run --allow-net --allow-read --unstable

import {main as clientMain} from './client.mjs'

/* Public API (partially un/documented) */

export const contentTypes = Object.assign(Object.create(null), {
  '.css':   'text/css',
  '.gif':   'image/gif',
  '.htm':   'text/html',
  '.html':  'text/html',
  '.ico':   'image/x-icon',
  '.jpeg':  'image/jpeg',
  '.jpg':   'image/jpeg',
  '.js':    'application/javascript',
  '.json':  'application/json',
  '.mjs':   'application/javascript',
  '.pdf':   'application/pdf',
  '.png':   'image/png',
  '.svg':   'image/svg+xml',
  '.tif':   'image/tiff',
  '.tiff':  'image/tiff',
  '.xml':   'text/xml',
  '.zip':   'application/zip',
  '.webp':  'image/webp',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
})

export const change = {type: 'change'}

export function send(body, opts) {
  valid(body, isDict)
  validOpt(opts, isDict)

  const url = new URL('send', loc(opts))
  opts = {headers: jsonHeaders, ...opts, method: 'POST', body: JSON.stringify(body)}

  return fetch(url, opts).then(resOkBody)
}

export function maybeSend(body, opts) {
  return send(body, opts).catch(logErr)
}

export async function* watch(target, dirs, opts) {
  validEachInst(dirs, Dir)

  for await (const {kind, paths} of watchFs(target, opts)) {
    const type = fsEventKindToType(kind)

    for (const absPath of paths) {
      const url = fileUrlFromAbs(absPath)

      for (const dir of dirs) {
        const path = dir.rel(url)

        if (dir.allow(path)) {
          yield {type, path}
          break
        }
      }
    }
  }
}

export async function resFile(req, dirs, opts) {
  validInst(req, Request)
  const info = await resolveFile(dirs, req.url)
  return info && resExactFile(info.url, opts)
}

export async function resSite(req, dirs, opts) {
  validInst(req, Request)
  const info = await resolveSiteFile(dirs, req.url)
  return info && resExactFile(info.url, opts)
}

export async function resSiteNotFound(req, dirs, opts) {
  validInst(req, Request)
  validOpt(opts, isDict)
  const info = await resolveFile(dirs, '404.html')
  return info && resExactFile(info.url, {...opts, status: 404})
}

export async function resSiteWithNotFound(req, dirs, opts) {
  validInst(req, Request)
  return (await resSite(req, dirs, opts)) || (await resSiteNotFound(req, dirs, opts))
}

export function resolve(dirs, url) {
  return procure(dirs, dirResolve, url)
}

async function resolveFile(dirs, url) {
  return (await resolve(dirs, url))?.onlyFile()
}

export function resolveSiteFile(dirs, url) {
  return procure(dirs, dirResolveSiteFile, url)
}

export async function resExactFile(path, opts) {
  const file = await Deno.open(path)

  try {
    const res = new Response(readableStreamFromReader(file, opts), opts)

    if (!res.headers.get('content-type')) {
      const type = contentType(path)
      if (type) res.headers.set('content-type', type)
    }

    return res
  }
  catch (err) {
    file.close()
    throw err
  }
}

export function contentType(path) {
  if (isInst(path, URL)) path = path.pathname
  return contentTypes[ext(path)]
}

export function clientPath(opts) {
  return new URL('client.mjs', loc(opts))
}

export function dir(...args) {return new Dir(...args)}

export class Dir {
  constructor(path, test) {
    validOpt(test, isTest)
    this.url = dirUrl(path, this.base())
    this.test = test
  }

  base() {return cwdUrl(Deno.cwd())}

  resolveUrl(url) {
    if (isInst(url, URL)) {
      if (url.protocol === 'file:') return url
      url = url.pathname
    }

    valid(url, isStr)
    return this.resolveUrl(urlAdd(url, this.url))
  }

  allowUrl(url) {
    return this.allow(this.rel(url))
  }

  allow(path) {
    valid(path, isStr)
    if (!path) return false

    const {test} = this
    if (isFun(test)) return test(path)
    if (isReg(test)) return test.test(path)
    return true
  }

  rel(url) {
    validInst(url, URL)
    return decodeURIComponent(trimPrefix(url.pathname, this.url.pathname))
  }
}

export class Broad extends Set {
  constructor({namespace = defaultNamespace, verbose} = {}) {
    valid(namespace, isStr)

    super()

    this.verbose   = verbose
    this.url       = dirUrl(namespace, this.base())
    this.urlClient = new URL('client.mjs', this.url)
    this.urlEvents = new URL('events', this.url)
    this.urlEvent  = new URL('event', this.url)
    this.urlSend   = new URL('send', this.url)
  }

  get [Symbol.toStringTag]() {return this.constructor.name}
  get EventClient() {return EventClient}
  get EventStreamClient() {return EventStreamClient}

  base() {return 'file:'}

  async send(msg) {
    for (const client of this) await client.write(msg)
  }

  resOr404(req) {
    return this.res(req) || new Response('not found', {status: 404})
  }

  res(req) {
    const res = nopMethodRes(req)
    if (res) return res

    const url = new URL(toPathname(req.url), this.base())

    return (
      url.href === this.urlClient.href ? this.resClient(req) :
      url.href === this.urlEvents.href ? this.resEvents(req) :
      url.href === this.urlEvent.href ? this.resEvent(req) :
      url.href === this.urlSend.href ? this.resSend(req) :
      undefined
    )
  }

  resClient(req) {
    return onlyGet(req) || new Response(clientScriptBuf, {headers: corsJsHeaders})
  }

  resEvents(req) {
    return onlyGet(req) || this.resVia(req, this.EventStreamClient, {headers: corsEventStreamHeaders})
  }

  resEvent(req) {
    return onlyGet(req) || this.resVia(req, this.EventClient, {headers: corsJsonHeaders})
  }

  resVia(req, Client, opts) {
    const sig = req.signal
    if (sig?.aborted) return undefined
    return new Response(new Client(this, sig), opts)
  }

  async resSend(req) {
    const res = onlyPost(req)
    if (res) return res

    const msg = await req.json()
    try {
      await this.send(msg)
      return new Response(`true`, {headers: corsJsonHeaders})
    }
    catch (err) {
      return errRes(err)
    }
  }

  add(val) {
    validInst(val, BroadClient)
    super.add(val)
  }

  clear() {
    for (const val of this) {
      super.delete(val)
      val.deinit()
    }
  }

  deinit(msg) {
    validOpt(msg, isDict)
    msg = {type: 'deinit', ...msg}

    for (const val of this) {
      val.write(msg)
      val.deinit()
    }
  }
}

/* Internal Utils */

const defaultNamespace = '/afr/'
const defaultHostname = 'localhost'
const defaultChunkSize = 1 << 14
const enc = new TextEncoder()
const clientScript = `void ${clientMain.toString()}()`
const clientScriptBuf = enc.encode(clientScript)

const corsHeaders = {
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'OPTIONS, HEAD, GET, POST',
  'access-control-allow-origin': '*',
}

const eventStreamHeaders = {
  'content-type': 'text/event-stream',
  'transfer-encoding': 'utf-8',
}

const jsonHeaders = {'content-type': 'application/json'}
const jsHeaders = {'content-type': 'application/javascript'}
const corsJsonHeaders = {...corsHeaders, ...jsonHeaders}
const corsJsHeaders = {...corsHeaders, ...jsHeaders}
const corsEventStreamHeaders = {...corsHeaders, ...eventStreamHeaders}

export async function main({namespace, hostname = defaultHostname, verbose, ...opts}) {
  const bro = new Broad({namespace, verbose})
  const listener = Deno.listen({hostname, ...opts})

  if (verbose) {
    console.log(`[afr] listening on http://${hostname || 'localhost'}:${listener.addr.port}`)
  }

  async function serveHttp(conn) {
    for await (const event of Deno.serveHttp(conn)) {
      try {
        await event.respondWith(bro.resOr404(event.request))
      }
      catch (err) {
        if (verbose && shouldLogErr(err)) {
          console.error(`[afr] unexpected error while serving ${event.request.url}:`, err)
        }
      }
    }
  }

  for await (const conn of listener) serveHttp(conn).catch(logErr)
}

export function mainWithArgs(args) {
  valid(args, isArr)

  const arg = args[0]
  if (!args.length || arg === 'help' || arg === '--help' || arg === '-h') {
    console.log(`
Runs an Afr broadcaster server; "--port" is required. Examples:

  afr --help
  afr --port 23456
  afr --port 23456 --verbose true
  afr --port 23456 --hostname 0.0.0.0
`.trim())
    return
  }

  return main(parseArgs(args))
}

// Variant of `Deno.watchFs` with support for `AbortSignal`.
export async function* watchFs(target, opts) {
  const sig = opts?.signal
  const iter = Deno.watchFs(target, opts)
  const deinit = iter.return.bind(iter)

  try {
    sig?.addEventListener('abort', deinit, {once: true})
    for await (const event of iter) yield event
  }
  finally {
    sig?.removeEventListener('abort', deinit)
    iter.return()
  }
}

export class ReadWriter extends ReadableStream {
  constructor(opts) {
    let ctrl = undefined
    let self = undefined

    super({
      start(val) {
        ctrl = val
        return opts?.start?.(val)
      },
      cancel() {
        self?.deinit()
      },
      ...opts,
    })

    self = this
    this.ctrl = ctrl
  }

  write(val) {return this.ctrl.enqueue(val)}

  // WHATWG streams have non-idempotent close, throwing on repeated calls.
  // We have multiple code paths / callbacks leading to multiple calls.
  deinit() {
    try {this.ctrl.close()}
    catch (err) {ignore(err)}
  }
}

export class BroadClient extends ReadWriter {
  constructor(bro, sig, opts) {
    validInst(bro, Broad)
    validInstOpt(sig, AbortSignal)

    if (sig?.aborted) {
      throw Error(`can't construct client: incoming signal already aborted`)
    }

    super(opts)

    this.bro = bro
    this.sig = sig
    this.bro.add(this)
    sig?.addEventListener('abort', this, {once: true})
  }

  handleEvent(event) {
    if (event?.type === 'abort') this.deinit()
  }

  deinit() {
    this.sig?.removeEventListener('abort', this)
    this.bro.delete(this)
    super.deinit()
  }
}

export class EventClient extends BroadClient {
  write(val) {
    super.write(enc.encode(JSON.stringify(val)))
    this.deinit()
  }
}

export class EventStreamClient extends BroadClient {
  write(val) {
    super.write(enc.encode(`data: ${JSON.stringify(val) || ''}\n\n`))
  }
}

export class FsInfo {
  constructor(url, stat) {
    validInst(url, URL)
    valid(stat, isComp)

    this.url = url
    this.stat = stat
  }

  onlyFile() {
    return this.stat.isFile ? this : undefined
  }
}

export async function dirResolve(dir, url) {
  validInst(dir, Dir)

  url = dir.resolveUrl(url)
  if (url.pathname.includes('..')) return undefined

  if (!dir.allowUrl(url)) return undefined

  const stat = await fsMaybeStat(url)
  if (!stat) return undefined

  return new FsInfo(url, stat)
}

export async function dirResolveFile(...args) {
  return (await dirResolve(...args))?.onlyFile()
}

// Loose port of https://github.com/mitranim/srv.
export async function dirResolveSiteFile(dir, url) {
  validInst(dir, Dir)

  url = dir.resolveUrl(url)

  return (
    (await dirResolveFile(dir, url))
    || (!ext(url.pathname) && (
      (
        !url.pathname.endsWith('/')
        && (await dirResolveFile(dir, urlWith(url, add, '.html')))
      )
      || (await dirResolveFile(dir, relUrl('index.html', url)))
    ))
    || false
  )
}

export async function fsMaybeStat(path) {
  try {
    return await Deno.stat(path)
  }
  catch (err) {
    // TODO: consider supporting other types, such as permissions errors.
    if (isNotFoundErr(err)) return undefined
    throw err
  }
}

export async function procure(dirs, fun, ...args) {
  validEachInst(dirs, Dir)
  valid(fun, isFun)

  for (const dir of dirs) {
    const val = await fun(dir, ...args)
    if (val) return val
  }

  return undefined
}

export function readableStreamFromReader(reader, opts) {
  const chunkSize = opts?.chunkSize || defaultChunkSize

  return new ReadableStream({
    async pull(ctrl) {
      const chunk = new Uint8Array(chunkSize)

      try {
        const count = await reader.read(chunk)

        if (isNil(count)) {
          ctrl.close()
          reader.close?.()
          return
        }

        ctrl.enqueue(chunk.subarray(0, count))
      } catch (err) {
        ctrl.error(err)
        reader.close?.()
      }
    },
    cancel() {
      reader.close?.()
    },
  })
}

function add(a, b) {return a + b}

function isNil(val)       {return val == null}
function isStr(val)       {return typeof val === 'string'}
function isNum(val)       {return typeof val === 'number'}
function isInt(val)       {return isNum(val) && ((val % 1) === 0)}
function isNatPos(val)    {return isInt(val) && val > 0}
function isFun(val)       {return typeof val === 'function'}
function isObj(val)       {return val !== null && typeof val === 'object'}
function isArr(val)       {return isInst(val, Array)}
function isReg(val)       {return isInst(val, RegExp)}
function isComp(val)      {return isObj(val) || isFun(val)}
function isTest(val)      {return isFun(val) || isReg(val)}
function isInst(val, Cls) {return isComp(val) && val instanceof Cls}

function isDict(val) {
  if (!isObj(val)) return false
  const proto = Object.getPrototypeOf(val)
  return proto === null || proto === Object.prototype
}

function valid(val, test) {
  if (!isFun(test)) throw TypeError(`expected validator function, got ${show(test)}`)
  if (!test(val)) invalid(val, test)
}

function validOpt(val, test) {
  if (!isNil(val)) valid(val, test)
}

function validEachInst(vals, Cls) {
  valid(vals, isArr)
  vals.forEach(validInstOf, Cls)
}

function validInstOf(val) {validInst(val, this)}

function invalid(val, test) {
  throw TypeError(`expected ${show(val)} to satisfy test ${show(test)}`)
}

function validInst(val, Cls) {
  if (!isInst(val, Cls)) {
    const cons = val?.constructor
    throw TypeError(`expected ${show(val)}${cons ? ` (instance of ${show(cons)})` : ``} to be an instance of ${show(Cls)}`)
  }
}

function validInstOpt(val, Cls) {
  valid(Cls, isFun)
  if (!isNil(val)) validInst(val, Cls)
}

function show(val) {
  if (isFun(val) && val.name) return val.name

  // Plain data becomes JSON, if possible.
  if (isArr(val) || isDict(val) || isStr(val)) {
    try {
      return JSON.stringify(val)
    }
    catch (__) {
      return String(val)
    }
  }

  return String(val)
}

export function loc({url, port, hostname = defaultHostname, namespace = defaultNamespace}) {
  if (!url) {
    valid(port, isNatPos)
    valid(hostname, isStr)
    url = `http://${hostname}:${port}`
  }

  return new URL(ensureTrailingSlash(namespace), url)
}

function ext(path) {
  valid(path, isStr)
  return path.match(/[^\\/]([.]\w+)$/)?.[1] || ''
}

function relPathname(val) {
  return trimLeadingSlash(toPathname(val))
}

function toPathname(val) {
  return toUrl(val, 'file:').pathname
}

function toUrl(val, base) {
  if (isInst(val, URL)) return
  valid(val, isStr)
  return new URL(val, base)
}

function ensureLeadingSlash(val) {
  valid(val, isStr)
  if (val[0] !== '/') val = '/' + val
  return val
}

function trimLeadingSlash(val) {
  valid(val, isStr)
  return val.replace(/^[/]/g, '')
}

function ensureTrailingSlash(val) {
  valid(val, isStr)
  if (!val.endsWith('/')) val += '/'
  return val
}

function urlMut(url, fun, ...args) {
  validInst(url, URL)

  const val = fun(url.pathname, ...args)
  valid(val, isStr)

  url.pathname = val
  return url
}

function urlWith(url, fun, ...args) {
  return urlMut(new URL(url), fun, ...args)
}

function dirUrl(path, base) {
  return urlMut(new URL(pathToPosix(path), base), ensureTrailingSlash)
}

function relUrl(path, base) {
  validInst(base, URL)
  if (!base.pathname.endsWith('/')) base = urlWith(base, ensureTrailingSlash)
  return new URL(relPathname(path), base)
}

function cwdUrl(cwd) {
  return urlMut(fileUrlFromAbs(cwd), ensureTrailingSlash)
}

function urlAdd(sub, sup) {
  return new URL(trimLeadingSlash(sub), sup)
}

// Adapter for Windows paths like `C:\\blah`. Unnecessary/nop on Unix.
function fileUrlFromAbs(path) {
  return new URL(ensureLeadingSlash(pathToPosix(path)), 'file:')
}

function pathToPosix(val) {
  valid(val, isStr)
  return val.replace(/[\\]/g, '/')
}

function trimPrefix(str, pre) {
  valid(str, isStr)
  valid(pre, isStr)
  if (!str.startsWith(pre)) return ''
  return str.slice(pre.length)
}

export function ignore() {}

function nopRes() {return new Response()}

export function errRes(err) {
  const msg = (err && (err.stack || err.message || err.code)) || `unknown ${err?.name || 'error'}`
  return new Response(msg, {status: 500})
}

function nopMethodRes({method}) {
  return method === 'HEAD' || method === 'OPTIONS' ? nopRes() : undefined
}

function onlyMethod(req, method) {
  return req.method !== method ? resMethodNotAllowed(req) : undefined
}

function onlyGet(req) {return onlyMethod(req, 'GET')}
function onlyPost(req) {return onlyMethod(req, 'POST')}

function resMethodNotAllowed(req) {
  const {method, url} = req
  const {pathname} = new URL(url)
  return new Response(`method ${method} not allowed for path ${pathname}`, {status: 405})
}

export function logErr(err) {
  if (shouldLogErr(err)) console.error(`[afr]`, err)
}

export function shouldLogErr(err) {
  return Boolean(err) && !isCancelErr(err)
}

function isCancelErr(err) {
  return isInst(err, Error) && (
    err.name === 'AbortError' ||
    err.name === 'ConnectionAborted' ||
    (err.name === 'Http' && err.message.includes('connection closed'))
  )
}

function isNotFoundErr(err) {
  return isInst(err, Error) && err.name === 'NotFound'
}

async function resOk(res) {
  const {ok, status} = res
  if (ok) return res

  const body = await res.text()
  throw Error(`non-OK response${status ? ` (code ${status})` : ''}: ${body}`)
}

function resBody(res) {
  const type = res.headers.get('content-type')
  if (type && /\bapplication[/]json\b/.test(type)) {
    return res.json()
  }
  return res.text()
}

function resOkBody(res) {
  return resOk(res).then(resBody)
}

function parseArgs(args) {
  valid(args, isArr)
  args = args.slice()

  const opts = {}

  while (args.length) {
    const arg = args.shift()

    const flagReg = /^--(\w+)$/
    if (!flagReg.test(arg)) throw Error(`expected flag like "--arg", found ${show(arg)}`)
    const key = arg.match(flagReg)[1]

    if (!args.length) throw Error(`expected value following flag ${show(arg)}`)
    opts[key] = maybeJsonParse(args.shift())
  }

  return opts
}

function maybeJsonParse(val) {
  if (!isStr(val)) return val

  try {
    return JSON.parse(val)
  }
  catch (err) {
    if (err.name === 'SyntaxError') return val
    throw err
  }
}

// Normalize to the types emitted by Node and understood by our client.
// Semi-placeholder, should add support for other kinds.
function fsEventKindToType(kind) {
  valid(kind, isStr)
  return kind === 'modify' ? 'change' : kind
}

if (import.meta.main) mainWithArgs(Deno.args)
