import * as cp from 'child_process'
import * as fp from 'fs/promises'
import * as fs from 'fs'
import * as ht from 'http'
import * as pt from 'path'
import * as ur from 'url'

/* Public vars */

export const defaultPort = 23456

export const change = {type: 'change'}

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
  '.webp':  'image/webp',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.xml':   'text/xml',
  '.zip':   'application/zip',
}

/* Public funs */

export function dirs()  {return new Dirs(...arguments)}
export function dir()   {return new Dir(...arguments)}
export function wat()   {return new Watcher(...arguments)}
export function broad() {return new Broadcaster(...arguments)}
export function aio()   {return new Aio(...arguments)}

export function daemonExists({port = defaultPort, timeout = defaultTimeout} = {}) {
  const req = ht.get({port, timeout})
  return reqWait(req).then(resOnlyOk).then(streamToJson)
}

// Known problem: doesn't report errors or startup messages.
export function daemonStart(opts) {
  const proc = cp.fork(
    cliDir,
    ['server-start', ...encodeOpts(opts)],
    {detached: true, stdio: 'ignore'},
  )

  proc.disconnect()
  proc.unref()

  return new Promise(function daemonSpawn(done, fail) {
    proc.once('spawn', done)
    proc.once('error', fail)
  })
}

export async function daemonStop(opts) {
  try {
    return await daemonSend({type: 'deinit'}, opts)
  }
  catch (err) {
    if (err.code === 'ECONNRESET') return true
    throw err
  }
}

export async function daemonRestart(opts) {
  try {
    await daemonStop(opts)
  }
  catch (err) {
    if (err.code !== 'ECONNREFUSED') throw err
  }
  return daemonStart(opts)
}

export async function daemonSend(
  body,
  {port = defaultPort, timeout = defaultTimeout, key} = {},
) {
  valid(body, isDict)
  const req = ht.request({port, method: 'post', timeout})
  req.end(JSON.stringify({key, ...body}))
  return reqWait(req).then(resOnlyOk).then(streamToJson)
}

export function daemonMaybeSend() {
  return daemonSend(...arguments).catch(ignore)
}

export function serveFile(res, status, fsPath) {
  if (status) valid(status, isNum)
  valid(fsPath, isStr)

  return new Promise(function initPromiseServeFile(done, fail) {
    const stream = fs.createReadStream(fsPath)

    stream.once('readable', function onReadable() {
      maybeSetContentType(res, fsPath)
      if (status) res.writeHead(status)
    })

    stream.once('error', fail)
    stream.once('close', done.bind(undefined, true))
    stream.pipe(res)
  })
}

export function fsMsg(type, path) {
  valid(type, isStr)
  return {type, path: fsPathToUrlPath(path)}
}

export function onListen(srv, err) {
  if (err) throw err
  const {port} = srv.address()
  console.log(`listening on http://localhost:${port}`)
}

/* Public classes */

export class Dirs extends Array {
  constructor(...args) {
    for (const arg of args) validInst(arg, Dir)
    super(...args)
    bind(this, 'handleFile', 'handleSite', 'handleFileOr404', 'handleSiteOr404')
  }

  watch(wat, opts, fun) {
    validInst(wat, Watcher)
    valid(fun, isFun)
    for (const dir of this) dir.watch(wat, opts, fun)
  }

  watchMsg(wat, opts, fun) {
    valid(fun, isFun)
    const onFsEvent = (...args) => {
      fun(this.fsMsg(...args))
    }
    this.watch(wat, opts, onFsEvent)
  }

  async handleFile(req, res) {
    for (const dir of this) {
      if (await dir.handleFile(req, res)) return true
    }
    return false
  }

  async handleSite(req, res) {
    for (const dir of this) {
      if (await dir.handleFileOrIndex(req, res)) return true
    }
    return this.handleNotFoundFile(req, res)
  }

  async handleFileOr404(req, res) {
    return (await this.handleFile(req, res)) || endWith404(res)
  }

  async handleSiteOr404(req, res) {
    return (await this.handleSite(req, res)) || endWith404(res)
  }

  async handleFileOrIndex(req, res) {
    for (const dir of this) {
      if (await dir.handleFileOrIndex(req, res)) return true
    }
    return false
  }

  async handleNotFoundFile(req, res) {
    for (const dir of this) {
      if (await dir.handleNotFoundFile(req, res)) return true
    }
    return false
  }

  urlPathToFsPath(urlPath) {
    valid(urlPath, isStr)
    for (const dir of this) {
      const fsPath = dir.urlPathToFsPath(urlPath)
      if (fsPath) return fsPath
    }
    return undefined
  }

  fsPathToUrlPath(fsPath) {
    for (const dir of this) {
      const urlPath = dir.fsPathToUrlPath(fsPath)
      if (urlPath) return urlPath
    }
    return fsPathToUrlPath(fsPath)
  }

  fsMsg(type, path) {
    valid(type, isStr)
    return {type, path: this.fsPathToUrlPath(path)}
  }
}

export class Dir {
  constructor(root, test) {
    valid(root, isStr)
    if (!isNil(test)) valid(test, isDirTest)

    this.root = root
    this.test = test

    bind(this, 'handleFile', 'handleSite', 'handleFileOr404', 'handleSiteOr404')
  }

  watch(wat, opts, fun) {
    validInst(wat, Watcher)
    valid(fun, isFun)
    const onFsEvent = (type, path) => {
      if (this.allow(path)) fun(type, path)
    }
    wat.watch(this.root, opts, onFsEvent)
  }

  async handleFile(req, res) {
    const fsPath = await this.resolveFile(req)
    return (fsPath && await serveFile(res, 200, fsPath)) || false
  }

  async handleSite(req, res) {
    return (await this.handleFileOrIndex(req, res)) || this.handleNotFoundFile(req, res)
  }

  async handleFileOr404(req, res) {
    return (await this.handleFile(req, res)) || endWith404(res)
  }

  async handleSiteOr404(req, res) {
    return (await this.handleSite(req, res)) || endWith404(res)
  }

  // Approximately ported from `https://github.com/mitranim/srv`.
  async handleFileOrIndex(req, res) {
    if (onlyGet(res, req.method)) return true
    if (await this.handleFile(req, res)) return true

    const fsPath = this.urlPathToFsPath(req.url)
    if (!fsPath) return false

    // Assume that any path with an extension is for a specific file.
    // If not found, don't look for a directory index file.
    if (pt.extname(fsPath)) return false

    // Try +".html".
    {
      const path = fsPath + `.html`
      if (this.allow(path) && await fileExists(path)) {
        return serveFile(res, 200, path)
      }
    }

    // Try +"/index.html".
    {
      const path = pt.join(fsPath, `index.html`)
      if (this.allow(path) && await fileExists(path)) {
        return serveFile(res, 200, path)
      }
    }

    return false
  }

  async handleNotFoundFile(_req, res) {
    const fsPath = this.urlPathToFsPath('404.html')
    return (await fileExists(fsPath)) && serveFile(res, 404, fsPath)
  }

  async resolveFile({method, url}) {
    if (method !== 'GET') return undefined

    const fsPath = this.urlPathToFsPath(url)
    if (!fsPath) return undefined

    if (await fileExists(fsPath)) return fsPath
    return undefined
  }

  allow(path) {
    valid(path, isStr)
    const {test} = this
    if (isFun(test)) return test(path)
    if (isReg(test)) return test.test(path)
    return true
  }

  urlPathToFsPath(urlPath) {
    valid(urlPath, isStr)
    if (urlPath.includes('..')) return undefined

    const fsPath = urlPathToFsPath(this.root, urlPath)
    if (this.allow(fsPath)) return fsPath

    return undefined
  }

  fsPathToUrlPath(fsPath) {
    valid(fsPath, isStr)
    const fsRel = pt.relative(this.root, fsPath)
    if (!fsRel.startsWith('.')) return pt.posix.join('/', pathToPosix(fsRel))
    return undefined
  }
}

export class Watcher extends Set {
  add(ref) {
    valid(ref, isCloser)
    super.add(ref)
  }

  delete(ref) {
    if (this.has(ref)) {
      super.delete(ref)
      ref.close()
    }
  }

  watch(path, opts, fun) {
    valid(fun, isFun)
    this.add(fs.watch(path, watchOpts(opts), onFsEventAtPath.bind(undefined, path, fun)))
  }

  deinit() {
    for (const ref of this) this.delete(ref)
  }
}

export class Broadcaster extends Set {
  constructor({namespace = '/afr'} = {}) {
    super()
    this.namespace = namespace
    bind(this, 'send', 'handle')
  }

  add(res) {
    validInst(res, ht.ServerResponse)
    super.add(res)
    res.once('close', super.delete.bind(this, res))
  }

  delete(res) {
    if (this.has(res)) {
      super.delete(res)
      res.end()
    }
  }

  send(msg) {
    const body = JSON.stringify(msg)

    for (const res of this) {
      if (res.isEventStream) {
        res.write(`data: ${body}\n\n`)
        continue
      }

      super.delete(res)
      headJson(res)
      endWith(res, 200, body)
    }
  }

  handle(req, res) {
    const {pathname} = ur.parse(req.url)

    if (pathname === pt.posix.join(this.namespace, 'client.mjs')) {
      if (onlyGet(res, req.method)) return true
      const path = clientScriptPath

      // TODO: use `serveFile` instead.
      maybeSetContentType(res, path)
      fs.createReadStream(path).pipe(res)
      return true
    }

    if (pathname === pt.posix.join(this.namespace, 'event')) {
      if (onlyGet(res, req.method)) return true
      this.add(res)
      return true
    }

    if (pathname === pt.posix.join(this.namespace, 'events')) {
      if (onlyGet(res, req.method)) return true
      initEventStreamRes(res)
      this.add(res)
      return true
    }

    return false
  }

  deinit(msg) {
    this.send({type: 'deinit', ...msg})
  }
}

// Short for "all-in-one".
export class Aio {
  constructor(opts) {
    this.wat = new Watcher()
    this.bro = new Broadcaster(opts)
    this.dirs = new Dirs()
    bind(this, 'send', 'handle', 'handleFile', 'handleSite', 'handleFileOr404', 'handleSiteOr404', 'onFsEvent')
  }

  serve() {
    this.dirs.push(dir(...arguments))
  }

  watch(root, test, opts) {
    dir(root, test).watch(this.wat, opts, this.onFsEvent)
  }

  send()                    {return this.bro.send(...arguments)}
  handle()                  {return this.bro.handle(...arguments)}
  handleFile(req, res)      {return this.handle(req, res) || this.dirs.handleFile(req, res)}
  handleSite(req, res)      {return this.handle(req, res) || this.dirs.handleSite(req, res)}
  handleFileOr404(req, res) {return this.handle(req, res) || this.dirs.handleFileOr404(req, res)}
  handleSiteOr404(req, res) {return this.handle(req, res) || this.dirs.handleSiteOr404(req, res)}

  onFsEvent(type, path) {
    this.bro.send(this.dirs.fsMsg(type, path))
  }

  deinit() {
    this.wat.deinit()
    this.bro.deinit()
  }
}

/* Internal Utils */

const moduleDir = pt.dirname(ur.fileURLToPath(import.meta.url))
const cliDir = pt.join(moduleDir, 'bin/afr.mjs')
const clientScriptPath = pt.join(moduleDir, 'client.mjs')
const defaultTimeout = 128

// Semi-private, used by the CLI tool.
export async function daemonServerStart(opts) {
  const srv = new DaemonServer(opts)

  return new Promise(function initPromiseStartDaemonServer(done, fail) {
    srv.listen(function onServerListen(err) {
      if (err) fail(err)
      else done(srv.srv.address())
    })
  })
}

// Used by `daemonServerStart`, exported just in case, undocumented.
export class DaemonServer extends Broadcaster {
  constructor({port = defaultPort, namespace = '/', ...opts} = {}) {
    super({namespace, ...opts})

    this.port  = port
    this.srv   = new ht.Server()
    this.conns = new Set()

    bind(this, 'onConnection', 'onRequest')

    this.srv.on('request', this.onRequest)
    this.srv.on('connection', this.onConnection)
  }

  listen(done) {
    this.srv.listen(this.port, done)
  }

  async handle(req, res) {
    allowCors(res)
    if (await super.handle(req, res)) return true

    const {method} = req
    const {pathname} = ur.parse(req.url)

    if (pathname === pt.posix.join(this.namespace, '/')) {
      if (handleNopMethods(res, method)) return true
      if (method === 'GET') return this.onGet(req, res)
      if (method === 'POST') return this.onPost(req, res)
      return methodNotAllowed(res)
    }

    return false
  }

  onGet(_req, res) {
    return endWithJson(res, 200, true)
  }

  async onPost(req, res) {
    try {
      const str = String(await readFirstChunk(req))
      if (!str) throw Error(`missing client request`)

      const msg = JSON.parse(str)
      valid(msg, isDict)

      const {type} = msg

      if (type === 'deinit') {
        this.deinit(msg)
        return endWithJson(res, 200, true)
      }

      this.send(msg)
      return endWithJson(res, 200, true)
    }
    catch (err) {
      return endWithJson(res, 500, errToData(err))
    }
  }

  onConnection(conn) {
    this.conns.add(conn)
    conn.once('end', this.conns.delete.bind(this.conns, conn))
  }

  async onRequest(req, res) {
    return (await this.handle(req, res)) || endWith404(res)
  }

  deinit(msg) {
    super.deinit(msg)

    this.srv.close()

    for (const conn of this.conns) {
      this.conns.delete(conn)
      conn.destroy()
    }
  }
}

async function fileExists(fsPath) {
  if (!fsPath) return false
  try {
    const stat = await fp.stat(fsPath)
    return Boolean(stat) && stat.isFile()
  }
  catch (err) {
    if (err.code === 'ENOENT') return false
    throw err
  }
}

function fsPathToUrlPath(path) {
  valid(path, isStr)
  return pt.posix.join('/', pathToPosix(pt.relative('.', path)))
}

function pathToPosix(path) {
  return path.replaceAll(pt.sep, pt.posix.sep)
}

// TODO: return a dict to be passed to `res.writeHead`.
function maybeSetContentType(res, path) {
  const type = contentType(path)
  if (type) res.setHeader('content-type', type)
}

function contentType(path) {
  return contentTypes[pt.extname(path)]
}

function endWith(res, status, ...args) {
  res.writeHead(status)
  res.end(...args)
  return true
}

function endWithJson(res, status, body) {
  headJson(res)
  return endWith(res, status, JSON.stringify(body))
}

// Without a non-empty response body, browsers tend to display a special error
// page that may confuse people, indicating a network error where there was
// none.
function endWith404(res) {
  return endWith(res, 404, 'not found')
}

function headJson(res) {
  res.setHeader('content-type', 'application/json')
}

function watchOpts(opts = {}) {
  valid(opts, isDict)
  return {
    persistent: false,
    recursive: true,
    ...opts,
  }
}

function onlyGet(res, method) {
  if (!method) return false
  if (handleNopMethods(res, method)) return true
  if (method !== 'GET') return methodNotAllowed(res)
  return false
}

function handleNopMethods(res, method) {
  if (method === 'HEAD' || method === 'OPTIONS') {
    res.end()
    return true
  }
  return false
}

function methodNotAllowed(res) {
  return endWith(res, 405)
}

// Adapted from `xhttp`.
function reqWait(req) {
  return new Promise(function initReq(done, fail) {
    req.once('response', function onReqRes(res) {
      done(res)
    })

    req.once('error', function onReqErr(err) {
      req.abort()
      fail(err)
    })

    req.once('timeout', function onReqTimeout() {
      fail(Object.assign(Error('request timeout'), {code: 'timeout'}))
    })

    req.once('abort', function onReqAbort() {
      fail(Object.assign(Error('request abort'), {code: 'abort'}))
    })

    req.once('aborted', function onReqAborted() {
      fail(Object.assign(Error('request aborted'), {code: 'aborted'}))
    })
  })
}

async function resOnlyOk(res) {
  const {statusCode} = res
  if (isHttpOk(statusCode)) return res

  const resBody = await readFirstChunk(res)
  throw Error(`non-OK daemon response${statusCode ? ` (code ${statusCode})` : ''}: ${resBody}`)
}

function streamToJson(stream) {
  return readFirstChunk(stream).then(jsonParse)
}

function jsonParse(val) {
  return isNil(val) ? undefined : JSON.parse(val)
}

// Loosely adapted from `xhttp`.
function readFirstChunk(stream) {
  return new Promise(function initStreamChunkReader(done, fail) {
    function onData(chunk) {
      clear()
      done(chunk)
    }

    function onError(err) {
      clear()
      fail(err)
    }

    function onEnd() {
      clear()
      done()
    }

    function clear() {
      stream.removeListener('data',  onData)
      stream.removeListener('error', onError)
      stream.removeListener('end',   onEnd)
    }

    stream.once('data',  onData)
    stream.once('error', onError)
    stream.once('end',   onEnd)
  })
}

function bind(ref, ...names) {
  for (const name of names) {
    Object.defineProperty(ref, name, {value: ref[name].bind(ref), writable: true})
  }
}

function encodeOpts(opts = {}) {
  valid(opts, isDict)
  return Object.entries(opts).flatMap(encodeOpt)
}

function encodeOpt([key, val]) {
  if (isNil(val)) return []
  return [`--${key}`, isStr(val) ? val : JSON.stringify(val)]
}

function errToData(err) {
  if (!err) return undefined
  if (isInst(err, Error)) err = err.message || err.code || err.stack
  return {error: err}
}

function allowCors(res) {
  res.setHeader('access-control-allow-credentials', 'true')
  res.setHeader('access-control-allow-headers', 'content-type')
  res.setHeader('access-control-allow-methods', 'OPTIONS, HEAD, GET, POST')
  res.setHeader('access-control-allow-origin', '*')
}

function onFsEventAtPath(root, fun, type, path) {
  fun(type, pt.join(root, path))
}

function isNil(val)       {return val == null}
function isStr(val)       {return typeof val === 'string'}
function isNum(val)       {return typeof val === 'number'}
function isFun(val)       {return typeof val === 'function'}
function isObj(val)       {return val !== null && typeof val === 'object'}
function isArr(val)       {return isInst(val, Array)}
function isReg(val)       {return isInst(val, RegExp)}
function isComp(val)      {return isObj(val) || isFun(val)}
function isCloser(val)    {return isObj(val) && isFun(val.close)}
function isInst(val, Cls) {return isComp(val) && val instanceof Cls}

function isDict(val) {
  if (!isObj(val)) return false
  const proto = Object.getPrototypeOf(val)
  return proto === null || proto === Object.prototype
}

function valid(val, test) {
  if (!isFun(test)) throw Error(`expected validator function, got ${show(test)}`)
  if (!test(val)) invalid(val, test)
}

function invalid(val, test) {
  throw Error(`expected ${show(val)} to satisfy test ${show(test)}`)
}

function validInst(val, Cls) {
  if (!isInst(val, Cls)) {
    throw Error(`expected ${show(val)} to be an instance of ${show(Cls)}`)
  }
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

function isHttpOk(code) {
  return code >= 200 && code < 300
}

function initEventStreamRes(res) {
  res.isEventStream = true
  res.setHeader('content-type', 'text/event-stream')
  res.setHeader('transfer-encoding', 'utf-8')
}

function ignore() {}

function isDirTest(val) {
  return isFun(val) || isReg(val)
}

function urlPathToFsPath(root, urlPath) {
  urlPath = new URL(urlPath, 'file:').pathname

  const rootUrl = ur.pathToFileURL(root)
  rootUrl.pathname = pt.posix.join(rootUrl.pathname, urlPath)

  const fsPath = ur.fileURLToPath(rootUrl)

  if (pt.isAbsolute(root)) return fsPath
  return pt.relative(process.cwd(), fsPath)
}
