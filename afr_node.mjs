#!/usr/bin/env node

import * as pt from 'path'
import * as fs from 'fs'
import * as fp from 'fs/promises'
import * as ht from 'http'
import * as ut from 'util'
import * as ur from 'url'
import * as s from './afr_shared.mjs'

export {change, contentTypes, contentType, clientPath} from './afr_shared.mjs'

export function send(...args) {return s.send(fetch, ...args)}

export function maybeSend(...args) {return send(...args).catch(s.ignore)}

export async function stat(...args) {
  return Object.create((await fp.stat(...args)), statDesc)
}

export function open(...args) {
  return new Promise(function initOpen(done, fail) {
    const file = fs.createReadStream(...args)
    file.once('error', fail)
    file.once('readable', function onReadable() {done(file)})
  })
}

export async function* watch(target, dirs, opts) {
  s.validEachInst(dirs, Dir)

  if (!pt.isAbsolute(target)) target = pt.resolve(target)

  const isDir = (await fp.stat(target)).isDirectory()
  const base = isDir ? target : pt.dirname(target)
  const iter = fp.watch(target, opts)

  try {
    for await (const {eventType: type, filename} of iter) {
      const url = s.fileUrlFromAbs(pt.join(base, filename))

      for (const dir of dirs) {
        const path = dir.rel(url)

        if (dir.allow(path)) {
          yield {type, path}
          break
        }
      }
    }
  }
  finally {
    iter.return()
  }
}

export function serveExactFile(req, res, path, opts) {
  return s.serveExactFile(FS, new Req(req, res), path, opts)
}

export function serveFsInfo(req, res, fsInfo, opts) {
  return s.serveFsInfo(FS, new Req(req, res), fsInfo, opts)
}

export function serveFile(req, res, dirs, opts) {
  return s.serveFile(FS, new Req(req, res), dirs, opts)
}

export function serveSite(req, res, dirs, opts) {
  return s.serveSite(FS, new Req(req, res), dirs, opts)
}

export function serveSiteNotFound(req, res, dirs, opts) {
  return s.serveSiteNotFound(FS, new Req(req, res), dirs, opts)
}

export function serveSiteWithNotFound(req, res, dirs, opts) {
  return s.serveSiteWithNotFound(FS, new Req(req, res), dirs, opts)
}

export function resolve(dirs, url) {
  return s.resolve(FS, dirs, url)
}

export function resolveFile(dirs, url) {
  return s.resolveFile(FS, dirs, url)
}

export function resolveSiteFile(dirs, url) {
  return s.resolveSiteFile(FS, dirs, url)
}

export function dir(...args) {return new Dir(...args)}

export class Broad extends s.Broad {
  respond(req, res) {return super.respond(new Req(req, res))}
  respondOr404(req, res) {return super.respondOr404(new Req(req, res))}
  fs() {return FS}
}

export class Dir extends s.Dir {
  base() {return s.cwdUrl(process.cwd())}
}

/* Internal Utils */

export async function main({namespace, port, hostname = s.defaultHostname, verbose}) {
  const srv = new ht.Server()
  const bro = new Broad({namespace})

  srv.on('request', bro.respondOr404.bind(bro))

  await ut.promisify(srv.listen).call(srv, port, hostname)

  if (verbose) {
    console.log(`[afr] listening on http://${hostname}:${srv.address().port}`)
  }

  await ut.promisify(srv.once).call(srv, 'close')
}

export class Req {
  constructor(req, res) {
    if (s.isInst(req, Req)) return req

    s.validInst(req, ht.IncomingMessage)
    s.validInst(res, ht.ServerResponse)

    this.req = req
    this.res = res
    this.done = new Promise(function initReqDone(done) {res.once('close', done)})
  }

  get url() {return this.req.url}
  get method() {return this.req.method}
  get headers() {return this.req.headers}
  get body() {return this.req}

  readBody() {return readFirstChunk(this.req)}

  writeHead(...args) {this.res.writeHead(...args)}

  write(str) {
    const {res} = this
    return ut.promisify(res.write).call(res, str)
  }

  async respond({status, headers, body}) {
    const {res} = this

    if (status || headers) {
      await res.writeHead(status || 200, headers)
    }

    if (body?.pipe) {
      body.pipe(res)
      await streamDone(body)
    }
    else {
      res.end(body)
    }
  }

  deinit() {this.res.end()}
}

/* Internal Utils */

export const FS = {stat, open}

// Adapter for our `fetch` sham.
export class Res {
  constructor(res) {this.res = res}

  get ok() {return this.status >= 200 && this.status <= 299}
  get status() {return this.res.statusCode}
  get headers() {return new Headers(this.res.headers)}

  text() {return readFirstChunk(this.res)}
  async json() {return JSON.parse(await this.text())}
}

// Adapter for our `fetch` sham.
export class Headers {
  constructor(val) {
    if (s.isNil(val)) return
    if (!s.isInst(val, Headers)) s.valid(val, s.isDict)
    Object.assign(this, val)
  }

  get(key) {
    s.valid(key, s.isStr)
    return this[key]
  }
}

// A sham. Should be removed once Node supports DOM `fetch` natively.
export async function fetch(url, {body, ...opts}) {
  const req = ht.request(url, opts)
  req.end(body)
  return new Res(await reqWait(req))
}

export function streamDone(stream) {
  if (stream.closed) return Promise.resolve()

  return new Promise(function initStreamDone(done, fail) {
    stream.once('error', fail)
    stream.once('end', done)
  })
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

// Loosely adapted from `xhttp`.
export function readFirstChunk(stream) {
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

const statDesc = {
  isFile: {
    get() {return Object.getPrototypeOf(this).isFile()},
  },
  isDir: {
    get() {return this.isDirectory()},
  },
}

if (process.argv[1] === ur.fileURLToPath(import.meta.url)) {
  s.runMain(main, process.argv.slice(2))
}
