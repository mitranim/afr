import {main as clientMain} from './client.mjs'

export const defaultNamespace = '/afr/'
export const defaultHostname = 'localhost'
export const bufSize = 4096
export const crlf = '\r\n'
export const enc = new TextEncoder()
export const dec = new TextDecoder()
export const change = {type: 'change'}
export const clientScript = `void ${clientMain.toString()}()`

export const contentTypes = {
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
}

export const corsHeaders = {
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'OPTIONS, HEAD, GET, POST',
  'access-control-allow-origin': '*',
}

export const corsEventStreamHeaders = {
  ...corsHeaders,
  'content-type': 'text/event-stream',
  'transfer-encoding': 'utf-8',
}

export const corsJsonHeaders = {
  ...corsHeaders,
  'content-type': 'application/json',
}

export const corsJsHeaders = {
  ...corsHeaders,
  'content-type': 'application/javascript',
}

export function send(fetch, body, opts) {
  valid(fetch, isFun)
  valid(body, isDict)
  validOpt(opts, isDict)

  const url = new URL('send', loc(opts))
  opts = {...opts, method: 'POST', body: JSON.stringify(body)}

  return fetch(url, opts).then(resOkBody)
}

export async function serveExactFile(fs, req, path, opts) {
  valid(fs, isFs)
  validReq(req)
  validOpt(opts, isDict)

  const headers = opts?.headers
  validOpt(headers, isDict)

  if (!headers?.['content-type']) {
    const type = contentType(path)

    if (type) {
      opts = {...opts, headers: {...headers, 'content-type': type}}
    }
  }

  const file = await fs.open(path)

  try {await req.respond({...opts, body: file})}
  finally {file.close()}

  return true
}

export function serveFsInfo(fs, req, info, opts) {
  validInst(info, FsInfo)
  return serveExactFile(fs, req, info.url, opts)
}

export async function serveFile(fs, req, dirs, opts) {
  const info = await resolveFile(fs, dirs, req.url)
  return (info || false) && serveFsInfo(fs, req, info, opts)
}

export async function serveSite(fs, req, dirs, opts) {
  const info = await resolveSiteFile(fs, dirs, req.url)
  return (info || false) && serveFsInfo(fs, req, info, opts)
}

export async function serveSiteNotFound(fs, req, dirs, opts) {
  validOpt(opts, isDict)
  const info = await resolveFile(fs, dirs, '404.html')
  return (info || false) && serveFsInfo(fs, req, info, {...opts, status: 404})
}

export async function serveSiteWithNotFound(...args) {
  return (await serveSite(...args)) || (await serveSiteNotFound(...args))
}

export function resolve(fs, dirs, url) {
  return procure(fs, dirs, dirResolve, url)
}

export async function resolveFile(fs, dirs, url) {
  return (await resolve(fs, dirs, url))?.onlyFile()
}

export function resolveSiteFile(fs, dirs, url) {
  return procure(fs, dirs, dirResolveSiteFile, url)
}

export function runMain(main, args) {
  valid(main, isFun)
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

export class Broad extends Set {
  constructor({namespace = defaultNamespace} = {}) {
    valid(namespace, isStr)

    super()

    this.url           = dirUrl(namespace, this.base())
    this.urlClientFile = new URL('client.mjs', this.url)
    this.urlEvents     = new URL('events', this.url)
    this.urlEvent      = new URL('event', this.url)
    this.urlSend       = new URL('send', this.url)
  }

  base() {return 'file:'}

  add(req) {
    validReq(req)
    super.add(req)
    req.done.finally(super.delete.bind(this, req))
  }

  delete(req) {
    if (this.has(req)) {
      super.delete(req)
      req.deinit()
    }
  }

  clear() {
    this.forEach(this.delete, this)
  }

  async respondOr404(req) {
    return (await this.respond(req)) || respond404(req, {headers: corsHeaders})
  }

  async respond(req) {
    validReq(req)
    if (await handleNopMethods(req)) return true

    const url = new URL(toPathname(req.url), this.base())

    if (url.href === this.urlClientFile.href) return this.respondClientFile(req)
    if (url.href === this.urlEvents.href) return this.respondEvents(req)
    if (url.href === this.urlEvent.href) return this.respondEvent(req)
    if (url.href === this.urlSend.href) return this.respondSend(req)

    return false
  }

  async respondClientFile(req) {
    if (await onlyGet(req)) return true
    req.respond({body: clientScript, headers: corsJsHeaders})
    return true
  }

  async respondEvents(req) {
    if (await onlyGet(req)) return true

    req = new ReqEventStream(req)
    this.add(req)

    await this.withReq(req, req.init)
    return true
  }

  async respondEvent(req) {
    if (await onlyGet(req)) return true
    this.add(req)
    return true
  }

  async respondSend(req) {
    if (await onlyPost(req)) return true

    const body = await req.readBody()
    const res = (await this.sendStr(body).catch(errRes)) || {}

    await req.respond(res)
    return true
  }

  async send(...msgs) {
    msgs = msgs.map(JSON.stringify).filter(Boolean)
    await Promise.all(msgs.map(this.sendStr, this))
  }

  async sendStr(msg) {
    const out = []
    for (const req of this) out.push(this.sendTo(req, msg))
    await Promise.all(out)
  }

  async sendTo(req, msg) {
    await this.withReq(req, req.respond, {body: msg, headers: corsJsonHeaders})
  }

  async withReq(req, fun, ...args) {
    validReq(req)
    try {
      await fun.apply(req, args)
    }
    catch (err) {
      this.delete(req)
      onReqErr(err)
    }
  }

  deinit(msg) {
    validOpt(msg, isDict)
    this.send({type: 'deinit', ...msg})
    this.clear()
  }

  get [Symbol.toStringTag]() {return this.constructor.name}
}

export class Dir {
  constructor(path, test) {
    validOpt(test, isTest)
    this.url = dirUrl(path, this.base())
    this.test = test
  }

  base() {return 'file:'}
  stat() {throw new ErrOver()}
  open() {throw new ErrOver()}

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

export class ReqEventStream {
  constructor(req) {
    validReq(req)
    this.req = req
  }

  get done() {return this.req.done}

  async init() {
    await this.req.writeHead(200, corsEventStreamHeaders)
  }

  async respond({body}) {
    await this.req.write(`data: ${body}\n\n`)
  }

  deinit() {this.req.deinit()}
}

export async function dirResolve(fs, dir, url) {
  valid(fs, isFs)
  validInst(dir, Dir)

  url = dir.resolveUrl(url)
  if (url.pathname.includes('..')) return undefined

  if (!dir.allowUrl(url)) return undefined

  const stat = await fsMaybeStat(fs, url)
  if (!stat) return undefined

  return new FsInfo(url, stat)
}

export async function dirResolveFile(...args) {
  return (await dirResolve(...args))?.onlyFile()
}

// Loose port of https://github.com/mitranim/srv.
export async function dirResolveSiteFile(fs, dir, url) {
  valid(fs, isFs)
  validInst(dir, Dir)

  url = dir.resolveUrl(url)

  return (
    (await dirResolveFile(fs, dir, url))
    || (!ext(url.pathname) && (
      (
        !url.pathname.endsWith('/')
        && (await dirResolveFile(fs, dir, urlWith(url, add, '.html')))
      )
      || (await dirResolveFile(fs, dir, relUrl('index.html', url)))
    ))
    || false
  )
}

// TODO support Node errors.
function onReqErr(err) {
  if (err?.name === 'ConnectionAborted') return
  throw err
}

export async function fsMaybeStat(fs, path) {
  valid(fs, isFs)

  try {
    return await fs.stat(path)
  }
  catch (err) {
    // TODO: consider supporting other types, such as permissions errors.
    if (isErrFsNotFound(err)) return undefined
    throw err
  }
}

async function procure(fs, dirs, fun, ...args) {
  valid(fs, isFs)
  validEachInst(dirs, Dir)
  valid(fun, isFun)

  for (const dir of dirs) {
    const val = await fun(fs, dir, ...args)
    if (val) return val
  }

  return undefined
}

export async function respond404(req, opts) {
  validOpt(opts, isDict)
  await req.respond({...opts, status: 404, body: 'not found'})
  return true
}

export class ErrOver extends Error {
  constructor(msg) {super(msg || `override in subclass`)}
  get name() {return this.constructor.name}
  get [Symbol.toStringTag]() {return this.name}
}

export function validReq(val) {
  if (isComp(val) && isFun(val.respond)) return
  throw new TypeError(`expected a request object, got an instance of ${val?.constructor}`)
}

export function add(a, b) {return a + b}

export function isNil(val)       {return val == null}
export function isStr(val)       {return typeof val === 'string'}
export function isNum(val)       {return typeof val === 'number'}
export function isInt(val)       {return isNum(val) && ((val % 1) === 0)}
export function isNatPos(val)    {return isInt(val) && val > 0}
export function isFun(val)       {return typeof val === 'function'}
export function isObj(val)       {return val !== null && typeof val === 'object'}
export function isArr(val)       {return isInst(val, Array)}
export function isReg(val)       {return isInst(val, RegExp)}
export function isComp(val)      {return isObj(val) || isFun(val)}
export function isPromise(val)   {return isComp(val) && isFun(val.then)}
export function isCloser(val)    {return isComp(val) && isFun(val.close)}
export function isTest(val)      {return isFun(val) || isReg(val)}
export function isFs(val)        {return isComp(val) && isFun(val.stat) && isFun(val.open)}
export function isInst(val, Cls) {return isComp(val) && val instanceof Cls}

export function isDict(val) {
  if (!isObj(val)) return false
  const proto = Object.getPrototypeOf(val)
  return proto === null || proto === Object.prototype
}

export function valid(val, test) {
  if (!isFun(test)) throw TypeError(`expected validator function, got ${show(test)}`)
  if (!test(val)) invalid(val, test)
}

export function validOpt(val, test) {
  if (!isNil(val)) valid(val, test)
}

export function validEachInst(vals, Cls) {
  valid(vals, isArr)
  vals.forEach(validInstOf, Cls)
}

function validInstOf(val) {validInst(val, this)}

export function invalid(val, test) {
  throw TypeError(`expected ${show(val)} to satisfy test ${show(test)}`)
}

export function validInst(val, Cls) {
  if (!isInst(val, Cls)) {
    const cons = val?.constructor
    throw TypeError(`expected ${show(val)}${cons ? ` (instance of ${show(cons)})` : ``} to be an instance of ${show(Cls)}`)
  }
}

export function show(val) {
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

export function contentType(path) {
  if (isInst(path, URL)) path = path.pathname
  return contentTypes[ext(path)]
}

export function clientPath(opts) {
  return new URL('client.mjs', loc(opts))
}

export function loc({url, port, hostname = defaultHostname, namespace = defaultNamespace}) {
  if (!url) {
    valid(port, isNatPos)
    valid(hostname, isStr)
    url = `http://${hostname}:${port}`
  }

  return new URL(ensureTrailingSlash(namespace), url)
}

export function ext(path) {
  valid(path, isStr)
  return path.match(/(?:[^\\/])([.][^:\\/]+)$/)?.[1] || ''
}

export function relPathname(val) {
  return trimLeadingSlash(toPathname(val))
}

export function toPathname(val) {
  return toUrl(val, 'file:').pathname
}

export function toUrl(val, base) {
  if (isInst(val, URL)) return
  valid(val, isStr)
  return new URL(val, base)
}

export function ensureLeadingSlash(val) {
  valid(val, isStr)
  if (val[0] !== '/') val = '/' + val
  return val
}

export function trimLeadingSlash(val) {
  valid(val, isStr)
  return val.replace(/^[/]/g, '')
}

export function ensureTrailingSlash(val) {
  valid(val, isStr)
  if (!val.endsWith('/')) val += '/'
  return val
}

export function trimTrailingSlash(val) {
  valid(val, isStr)
  return val.replace(/[/]$/g, '')
}

export function urlMut(url, fun, ...args) {
  validInst(url, URL)

  const val = fun(url.pathname, ...args)
  valid(val, isStr)

  url.pathname = val
  return url
}

export function urlWith(url, fun, ...args) {
  return urlMut(new URL(url), fun, ...args)
}

export function dirUrl(path, base) {
  return urlMut(new URL(pathToPosix(path), base), ensureTrailingSlash)
}

export function relUrl(path, base) {
  validInst(base, URL)
  if (!base.pathname.endsWith('/')) base = urlWith(base, ensureTrailingSlash)
  return new URL(relPathname(path), base)
}

export function cwdUrl(cwd) {
  return urlMut(fileUrlFromAbs(cwd), ensureTrailingSlash)
}

export function urlAdd(sub, sup) {
  return new URL(trimLeadingSlash(sub), sup)
}

// Adapter for Windows paths like `C:\\blah`. Unnecessary/nop on Unix.
export function fileUrlFromAbs(path) {
  return new URL(ensureLeadingSlash(pathToPosix(path)), 'file:')
}

export function pathToPosix(val) {
  valid(val, isStr)
  return val.replace(/[\\]/g, '/')
}

export function trimPrefix(str, pre) {
  valid(str, isStr)
  valid(pre, isStr)
  if (!str.startsWith(pre)) return ''
  return str.slice(pre.length)
}

export function ignore() {}

export function errRes(err) {
  return {status: 500, body: err.message || err.code || err.stack || 'unknown error'}
}

export async function handleNopMethods(req) {
  const {method} = req
  if (method === 'HEAD' || method === 'OPTIONS') {
    await req.respond({})
    return true
  }
  return false
}

export function onlyMethod(req, method) {return req.method !== method && methodNotAllowed(req)}
export function onlyGet(req) {return onlyMethod(req, 'GET')}
export function onlyPost(req) {return onlyMethod(req, 'POST')}

export async function methodNotAllowed(req) {
  await req.respond({status: 405})
  return true
}

export function isErrFsNotFound(err) {
  return (
    // Deno
    err.name === 'NotFound' ||
    // Node
    err.code === 'ENOENT'
  )
}

export async function resOk(res) {
  const {ok, status} = res
  if (ok) return res

  const body = await res.text()
  throw Error(`non-OK response${status ? ` (code ${status})` : ''}: ${body}`)
}

export function resBody(res) {
  if (/application[/]json/.test(res.headers.get('content-type'))) {
    return res.json()
  }
  return res.text()
}

export function resOkBody(res) {
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
