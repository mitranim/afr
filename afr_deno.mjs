#!/usr/bin/env deno run --allow-net --allow-read

/* global Deno */

import * as s from './afr_shared.mjs'

export {change, contentTypes, contentType, clientPath} from './afr_shared.mjs'

// eslint-disable-next-line no-restricted-globals
export function send(...args) {return s.send(fetch, ...args)}

export function maybeSend(...args) {return send(...args).catch(s.ignore)}

export async function* watch(target, dirs, opts) {
  s.validEachInst(dirs, Dir)
  const iter = watchFs(target, opts)

  try {
    for await (const {kind, paths} of iter) {
      const type = fsEventKindToType(kind)

      for (const absPath of paths) {
        const url = s.fileUrlFromAbs(absPath)

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
  finally {
    iter.return()
  }
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

export function serveExactFile(req, path, opts) {
  return s.serveExactFile(Deno, new Req(req), path, opts)
}

export function serveFsInfo(req, fsInfo, opts) {
  return s.serveFsInfo(Deno, new Req(req), fsInfo, opts)
}

export function serveFile(req, dirs, opts) {
  return s.serveFile(Deno, new Req(req), dirs, opts)
}

export function serveSite(req, dirs, opts) {
  return s.serveSite(Deno, new Req(req), dirs, opts)
}

export function serveSiteNotFound(req, dirs, opts) {
  return s.serveSiteNotFound(Deno, new Req(req), dirs, opts)
}

export function serveSiteWithNotFound(req, dirs, opts) {
  return s.serveSiteWithNotFound(Deno, new Req(req), dirs, opts)
}

export function resolve(dirs, url) {
  return s.resolve(Deno, dirs, url)
}

export function resolveFile(dirs, url) {
  return s.resolveFile(Deno, dirs, url)
}

export function resolveSiteFile(dirs, url) {
  return s.resolveSiteFile(Deno, dirs, url)
}

export function dir(...args) {return new Dir(...args)}

export class Broad extends s.Broad {
  respond(req) {return super.respond(new Req(req))}
  respondOr404(req) {return super.respondOr404(new Req(req))}
  fs() {return Deno}
}

export class Dir extends s.Dir {
  base() {return s.cwdUrl(Deno.cwd())}
}

/* Internal Utils */

export async function main({namespace, hostname = s.defaultHostname, verbose, ...opts}) {
  const {serve} = await import('https://deno.land/std@0.97.0/http/server.ts')
  const srv = serve({hostname, ...opts})
  const bro = new Broad({namespace})

  if (verbose) {
    console.log(`[afr] listening on http://${hostname}:${srv.listener.addr.port}`)
  }

  for await (const req of srv) bro.respondOr404(req)
}

export class Req {
  constructor(req) {
    if (s.isInst(req, Req)) return req
    s.validReq(req)
    this.req = req
  }

  get url() {return this.req.url}
  get method() {return this.req.method}
  get headers() {return this.req.headers}
  get body() {return this.req.body}
  get done() {return this.req.done}

  readBody() {return readStr(this.req.body)}

  // Used by `Broad` for event stream responses.
  writeHead(status, headers) {
    s.valid(status, s.isNatPos)
    return this.write(
      `HTTP/1.1 ${status}` + s.crlf +
      encodeHeaders(headers) + s.crlf +
      s.crlf
    )
  }

  // Used by `Broad` for event stream responses.
  async write(str) {
    const {w} = this.req
    await w.write(s.enc.encode(str))
    await w.flush()
  }

  respond(res) {
    if (res?.headers) {
      res = {...res, headers: new Headers(res.headers)}
    }
    return this.req.respond(res)
  }

  deinit() {this.req.conn.close()}
}

export function encodeHeaders(head) {
  s.valid(head, s.isDict)

  let out = ''

  for (const key in head) {
    const val = head[key]

    s.valid(key, s.isStr)
    s.valid(val, s.isStr)

    out += `${key}: ${val}${s.crlf}`
  }

  return out
}

// Normalize to the types emitted by Node and understood by our client.
// Semi-placeholder, should add support for other kinds.
function fsEventKindToType(kind) {
  s.valid(kind, s.isStr)
  return kind === 'modify' ? 'change' : kind
}

// Dumb alternative to importing `io.readAll`.
async function readStr(reader) {
  const buf = new Uint8Array(4096)
  const count = await reader.read(buf)
  return s.dec.decode(buf.slice(0, count))
}

if (import.meta.main) s.runMain(main, Deno.args)
