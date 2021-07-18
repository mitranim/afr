#!/usr/bin/env -S deno run --allow-net --allow-read --unstable

/* global Deno */

import {main as clientMain} from './client.mjs'

/* Public API (partially un/documented) */

export const contentTypes: Record<string, string> = Object.assign(Object.create(null), {
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
} as Record<string, string>)

export const change: SendBody = {type: 'change'} as const

export type SendBody = WatchMsg | {type: string}
export type SendOpts = LocOpts & Omit<RequestInit, 'method' | 'body'>
export type AnyData = unknown

export function send(body: SendBody, opts: SendOpts) {
  valid(body, isDict)
  valid(opts, isDict)

  const url = new URL('send', loc(opts))
  const fetchOpts: RequestInit = {headers: jsonHeaders, ...opts, method: 'POST', body: JSON.stringify(body)}

  return fetch(url, fetchOpts).then(resOkBody)
}

export function maybeSend(body: SendBody, opts: SendOpts) {
  return send(body, opts).catch(logErr)
}

// The weird remapping is Node legacy and may be changed in the future.
export type WatchType = Omit<Deno.FsEvent['kind'], 'modify'> | 'change'

export interface WatchOpts {
  signal?: AbortSignal
  recursive: boolean
}

export interface WatchMsg {
  type: WatchType
  path: string
}

export type WatchTarget = string | string[]

export async function* watch(target: WatchTarget, dirs: Dir[], opts?: WatchOpts): AsyncGenerator<WatchMsg> {
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

export async function resFile(req: Request, dirs: Dir[], opts?: FileOpts) {
  validInst(req, Request)
  if (!isGet(req)) return undefined
  const info = await resolveFile(dirs, req.url)
  return info && resExactFile(info.url, opts)
}

export async function resSite(req: Request, dirs: Dir[], opts?: FileOpts) {
  validInst(req, Request)
  if (!isGet(req)) return undefined
  const info = await resolveSiteFile(dirs, req.url)
  return info && resExactFile(info.url, opts)
}

export async function resSiteNotFound(req: Request, dirs: Dir[], opts?: FileOpts) {
  validInst(req, Request)
  validOpt(opts, isDict)
  if (!isGet(req)) return undefined
  const info = await resolveFile(dirs, '404.html')
  return info && resExactFile(info.url, {...opts, status: 404})
}

export async function resSiteWithNotFound(req: Request, dirs: Dir[], opts?: FileOpts) {
  validInst(req, Request)
  return (await resSite(req, dirs, opts)) || (await resSiteNotFound(req, dirs, opts))
}

export function resolve(dirs: Dir[], url: string | URL): Promise<FsInfo | undefined> {
  return procure(dirs, dirResolve, url)
}

async function resolveFile(dirs: Dir[], url: string | URL): Promise<FsInfo | undefined> {
  return (await resolve(dirs, url))?.onlyFile()
}

export function resolveSiteFile(dirs: Dir[], url: string | URL): Promise<FsInfo | undefined> {
  return procure(dirs, dirResolveSiteFile, url)
}

export interface FileOpts extends ResponseInit, ReadableStreamFromReaderOpts {}

export async function resExactFile(path: string | URL, opts?: FileOpts) {
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

export function contentType(url: string | URL): string | undefined {
  return contentTypes[ext(toPathname(url))]
}

export function clientPath(opts: LocOpts) {
  return new URL('client.mjs', loc(opts))
}

export function dir(path: string, test?: StrTest) {return new Dir(path, test)}

export type StrTestFn = (str: string) => boolean
export type StrTest = RegExp | StrTestFn

export class Dir {
  url: URL
  test?: StrTest

  constructor(path: string, test?: StrTest) {
    this.url = dirUrl(path, this.base())
    this.test = validOpt(test, isStrTest)
  }

  base() {return cwdUrl(Deno.cwd())}

  resolveUrl(url: string | URL): URL {
    if (isInst(url, URL)) {
      if (url.protocol === 'file:') return url
      url = url.pathname
    }

    valid(url, isStr)
    return this.resolveUrl(urlAdd(url, this.url))
  }

  allowUrl(url: URL) {
    return this.allow(this.rel(url))
  }

  allow(path: string) {
    valid(path, isStr)
    if (!path) return false

    const {test} = this
    if (isFun<StrTestFn>(test)) return test(path)
    if (isReg(test)) return test.test(path)
    return true
  }

  rel(url: URL) {
    validInst(url, URL)
    return decodeURIComponent(trimPrefix(url.pathname, this.url.pathname))
  }
}

export interface BroadOpts {
  namespace?: string
  verbose?: boolean
}

export class Broad extends Set<BroadClient> {
  verbose?: boolean
  readonly url: URL
  readonly urlClient: URL
  readonly urlEvents: URL
  readonly urlEvent: URL
  readonly urlSend: URL

  constructor({namespace = defaultNamespace, verbose}: BroadOpts = {}) {
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

  async send(msg: AnyData) {
    for (const client of this) await client.writeJson(msg)
  }

  resOr404(req: Request) {
    return this.res(req) || new Response('not found', {status: 404})
  }

  res(req: Request) {
    const res = preflightRes(req)
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

  resClient(req: Request) {
    return onlyGet(req) || new Response(clientScriptBuf, {headers: corsJsHeaders})
  }

  resEvents(req: Request) {
    return onlyGet(req) || this.resVia(req, this.EventStreamClient, {headers: corsEventStreamHeaders})
  }

  resEvent(req: Request) {
    return onlyGet(req) || this.resVia(req, this.EventClient, {headers: corsJsonHeaders})
  }

  resVia<C extends typeof BroadClient>(req: Request, Client: C, opts?: ResponseInit) {
    const sig = req.signal
    if (sig?.aborted) return undefined
    return new Response(new Client(this, sig).reader, opts)
  }

  async resSend(req: Request) {
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

  add(val: BroadClient) {
    validInst(val, BroadClient)
    return super.add(val)
  }

  clear() {
    for (const val of this) {
      super.delete(val)
      val.deinit()
    }
  }

  deinit(msg: Dict) {
    msg = {type: 'deinit', ...validOpt(msg, isDict)}

    for (const val of this) {
      val.writeJson(msg)
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

interface MainOpts extends BroadOpts, Deno.ListenOptions {}

export async function main({namespace, hostname = defaultHostname, verbose, ...opts}: MainOpts) {
  const bro = new Broad({namespace, verbose})
  const lis = Deno.listen({hostname, ...opts})

  if (verbose) {
    const port = addrPort(lis.addr)
    console.log(`[afr] listening on http://${hostname || 'localhost'}${port ? `:${port}` : ``}`)
  }

  async function serveHttp(conn: Deno.Conn) {
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

  for await (const conn of lis) serveHttp(conn).catch(logErr)
}

function addrPort(addr: Deno.Addr): number | undefined {
  const {port} = addr as Deno.NetAddr
  return isNum(port) ? port : undefined
}

export function mainWithArgs(args: string[]) {
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
export async function* watchFs(target: WatchTarget, opts?: WatchOpts) {
  const sig = opts?.signal
  const iter = Deno.watchFs(target, opts)
  const deinit = iter.close.bind(iter)

  try {
    sig?.addEventListener('abort', deinit, {once: true})
    for await (const event of iter) yield event
  }
  finally {
    sig?.removeEventListener('abort', deinit)
    deinit()
  }
}

// Aliased to clarify the relationship between different parts of the code
// using this type.
export type Chunk = Uint8Array

export interface ReaderOpts<T> {
  start?: (ctrl: ReadableStreamDefaultController<T>) => void
}

// Not generic over the chunk/entry type because `writeJson` assumes/requires a
// stream of `Uint8Array` chunks.
export class ReadWriter {
  ctrl?: ReadableStreamDefaultController<Chunk>
  reader: ReadableStream<Chunk>

  constructor(opts?: ReaderOpts<Chunk>) {
    this.reader = new ReadableStream<Chunk>({
      start: ctrl => {
        this.ctrl = ctrl
        return opts?.start?.(ctrl)
      },
      cancel: this.deinit.bind(this),
    })
  }

  write(val: Chunk) {return this.ctrl!.enqueue(val)}
  writeJson(val: AnyData) {this.write(enc.encode(JSON.stringify(val)))}
  deinit() {streamClose(this.ctrl)}
}

export class BroadClient extends ReadWriter {
  readonly bro: Broad
  readonly sig: AbortSignal

  constructor(bro: Broad, sig: AbortSignal, opts?: ReaderOpts<Chunk>) {
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

  handleEvent(event: Event) {
    if (event?.type === 'abort') this.deinit()
  }

  deinit() {
    this.sig?.removeEventListener('abort', this)
    this.bro.delete(this)
    super.deinit()
  }
}

export class EventClient extends BroadClient {
  writeJson(val: AnyData) {
    super.writeJson(val)
    this.deinit()
  }
}

export class EventStreamClient extends BroadClient {
  writeJson(val: AnyData) {
    this.write(enc.encode(`data: ${JSON.stringify(val) || ''}\n\n`))
  }
}

export class FsInfo {
  readonly url: URL
  readonly stat: Deno.FileInfo

  constructor(url: URL, stat: Deno.FileInfo) {
    this.url = validInst(url, URL)
    this.stat = valid(stat, isFileInfo)
  }

  onlyFile() {
    return this.stat.isFile ? this : undefined
  }
}

export async function dirResolve(dir: Dir, url: string | URL) {
  validInst(dir, Dir)

  url = dir.resolveUrl(url)
  if (url.pathname.includes('..')) return undefined

  if (!dir.allowUrl(url)) return undefined

  const stat = await fsMaybeStat(url)
  if (!stat) return undefined

  return new FsInfo(url, stat)
}

export async function dirResolveFile(dir: Dir, url: string | URL) {
  return (await dirResolve(dir, url))?.onlyFile()
}

// Loose port of https://github.com/mitranim/srv.
export async function dirResolveSiteFile(dir: Dir, url: string | URL) {
  validInst(dir, Dir)

  url = dir.resolveUrl(url)

  return (
    (await dirResolveFile(dir, url))
    || (!ext(url.pathname) && (
      (
        !url.pathname.endsWith('/')
        && (await dirResolveFile(dir, urlMut(url, add, '.html')))
      )
      || (await dirResolveFile(dir, relUrl('index.html', url)))
    ))
    || undefined
  )
}

export async function fsMaybeStat(path: string | URL) {
  try {
    return await Deno.stat(path)
  }
  catch (err) {
    // TODO: consider supporting other types, such as permissions errors.
    if (isNotFoundErr(err)) return undefined
    throw err
  }
}

export async function procure<
  R,
  A,
  F extends (dir: Dir, ...args: [A]) => Promise<R | undefined>,
>(dirs: Dir[], fun: F, ...args: [A]): Promise<R | undefined> {
  validEachInst(dirs, Dir)
  valid(fun, isFun)

  for (const dir of dirs) {
    const val = await fun(dir, ...args)
    if (val) return val
  }

  return undefined
}

export interface ReadableStreamFromReaderOpts {chunkSize?: number}

export function readableStreamFromReader(reader: Deno.Reader | (Deno.Reader & Deno.Closer), opts?: ReadableStreamFromReaderOpts) {
  const chunkSize = opts?.chunkSize || defaultChunkSize

  return new ReadableStream({
    async pull(ctrl) {
      const chunk = new Uint8Array(chunkSize)

      try {
        const count = await reader.read(chunk)

        if (isNil(count)) {
          ctrl.close()
          if (isCloser(reader)) reader.close()
          return
        }

        ctrl.enqueue(chunk.subarray(0, count))
      }
      catch (err) {
        ctrl.error(err)
        if (isCloser(reader)) reader.close()
      }
    },
    cancel() {
      if (isCloser(reader)) reader.close()
    },
  })
}

function add(a: string, b: string) {return a + b}

type Nil = null | undefined

// deno-lint-ignore no-explicit-any
type Cons<T> = abstract new(...args: any[]) => T

type Test<T> = (val: unknown) => val is T

function isNil     (val: unknown): val is Nil      {return val == null}
function isStr     (val: unknown): val is string   {return typeof val === 'string'}
function isBool    (val: unknown): val is boolean  {return typeof val === 'boolean'}
function isNum     (val: unknown): val is number   {return typeof val === 'number'}
function isInt     (val: unknown): val is number   {return isNum(val) && ((val % 1) === 0)}
function isNatPos  (val: unknown): val is number   {return isInt(val) && val > 0}
function isReg     (val: unknown): val is RegExp   {return isInst(val, RegExp)}
function isStrTest (val: unknown): val is StrTest  {return isReg(val) || isFun<StrTestFn>(val)}

const isArr = Array.isArray

// deno-lint-ignore ban-types
function isCls<T extends Function = Function>(val: unknown): val is T {
  return isFun(val) && typeof val.prototype === 'object'
}

// deno-lint-ignore ban-types
function isFun<T extends Function = Function>(val: unknown): val is T {
  return typeof val === 'function'
}

// This actually detects `val is Object`. Our _runtime_ definition is `Dict` is
// more restrictive. However, this signature allows us to test arbitrary
// properties, which is permitted in JS, without TS barking.
function isObj(val: unknown): val is Dict {
  return val !== null && typeof val === 'object'
}

function isInst<T>(val: unknown, Cls: Cons<T>): val is T {
  return isObj(val) && val instanceof Cls
}

type Key = string | symbol
type Dict = Record<Key, unknown>

function isDict(val: unknown): val is Dict {
  if (!isObj(val)) return false
  const proto = Object.getPrototypeOf(val)
  return proto === null || proto === Object.prototype
}

function isCloser(val: unknown): val is Deno.Closer {
  return isObj(val) && isFun<() => void>(val.close)
}

function isFileInfo(val: unknown): val is Deno.FileInfo {
  return isObj(val) && isBool(val.isFile)
}

function valid<T>(val: unknown, test: Test<T>): T {
  if (!isFun<Test<T>>(test)) throw TypeError(`expected validator function, got ${show(test)}`)
  if (!test(val)) throw TypeError(`expected ${show(val)} to satisfy test ${show(test)}`)
  return val
}

function validOpt<T>(val: unknown, test: Test<T>): T | undefined {
  return isNil(val) ? undefined : valid(val, test)
}

function validEachInst<T>(vals: unknown[], Cls: Cons<T>): T[] {
  valid(vals, isArr)
  vals.forEach(validInstOf, Cls)
  return vals as T[]
}

function validInstOf<T>(this: Cons<T>, val: unknown) {
  validInst(val, this)
}

function validInst<T>(val: unknown, Cls: Cons<T>): T {
  valid(Cls, isCls)
  if (isInst(val, Cls)) return val
  const cons = isObj(val) ? val?.constructor : null
  throw TypeError(`expected ${show(val)}${cons ? ` (instance of ${show(cons)})` : ``} to be an instance of ${show(Cls)}`)
}

function validInstOpt<T>(val: unknown, Cls: Cons<T>): T | undefined {
  valid(Cls, isCls)
  return isNil(val) ? undefined : validInst(val, Cls)
}

function show(val: unknown) {
  if (isFun(val) && val.name) return val.name

  // Plain data becomes JSON, if possible.
  if (isArr(val) || isDict(val) || isStr(val)) {
    try {return JSON.stringify(val)}
    catch (err) {ignore(err)}
  }

  return String(val)
}

export interface LocOpts {
  url?: string | URL
  port?: number
  hostname?: string
  namespace?: string
}

export function loc({url, port, hostname = defaultHostname, namespace = defaultNamespace}: LocOpts) {
  if (!url) {
    valid(port, isNatPos)
    valid(hostname, isStr)
    url = `http://${hostname}:${port}`
  }

  return new URL(ensureTrailingSlash(namespace), url)
}

function ext(path: string) {
  valid(path, isStr)
  return path.match(/[^\\/]([.]\w+)$/)?.[1] || ''
}

function relPathname(val: string | URL) {
  return trimLeadingSlash(toPathname(val))
}

function toPathname(val: string | URL) {
  return toUrl(val, 'file:').pathname
}

function toUrl(val: string | URL, base?: string | URL) {
  if (isInst(val, URL)) return val
  valid(val, isStr)
  return new URL(val, base)
}

function ensureLeadingSlash(val: string) {
  valid(val, isStr)
  if (val[0] !== '/') val = '/' + val
  return val
}

function trimLeadingSlash(val: string) {
  valid(val, isStr)
  return val.replace(/^[/]/g, '')
}

function ensureTrailingSlash(val: string) {
  valid(val, isStr)
  if (!val.endsWith('/')) val += '/'
  return val
}

function urlMut<Fn extends (pathname: string) => string>(url: URL, fun: Fn): URL
function urlMut<Fn extends (pathname: string, ...args: [A1]) => string, A1>(url: URL, fun: Fn, ...args: [A1]): URL
function urlMut<Fn extends (pathname: string, ...args: unknown[]) => string>(url: URL, fun: Fn, ...args: unknown[]): URL {
  validInst(url, URL)

  const val = fun(url.pathname, ...args)
  valid(val, isStr)

  url.pathname = val
  return url
}

function dirUrl(path: string, base?: string | URL) {
  return urlMut(new URL(pathToPosix(path), base), ensureTrailingSlash)
}

function relUrl(path: string, base: URL) {
  validInst(base, URL)
  if (!base.pathname.endsWith('/')) base = urlMut(base, ensureTrailingSlash)
  return new URL(relPathname(path), base)
}

function cwdUrl(cwd: string) {
  return urlMut(fileUrlFromAbs(cwd), ensureTrailingSlash)
}

function urlAdd(sub: string, sup?: string | URL) {
  return new URL(trimLeadingSlash(sub), sup)
}

// Adapter for Windows paths like `C:\\blah`. Unnecessary/nop on Unix.
function fileUrlFromAbs(path: string) {
  return new URL(ensureLeadingSlash(pathToPosix(path)), 'file:')
}

function pathToPosix(val: string) {
  valid(val, isStr)
  return val.replace(/[\\]/g, '/')
}

function trimPrefix(str: string, pre: string) {
  valid(str, isStr)
  valid(pre, isStr)
  if (!str.startsWith(pre)) return ''
  return str.slice(pre.length)
}

function nopRes() {return new Response()}

interface CodedErr extends Error {code: string}

export function errRes(err: Error) {
  const msg = (
    err && (err.stack || err.message || (err as CodedErr).code)
  ) || `unknown ${err?.name || 'error'}`
  return new Response(msg, {status: 500})
}

function preflightRes(req: Request) {
  return hasMethod(req, 'HEAD') || hasMethod(req, 'OPTIONS') ? nopRes() : undefined
}

function onlyMethod(req: Request, method: string) {
  return hasMethod(req, method) ? undefined : resMethodNotAllowed(req)
}

function onlyGet(req: Request) {return onlyMethod(req, 'GET')}
function onlyPost(req: Request) {return onlyMethod(req, 'POST')}

function resMethodNotAllowed(req: Request) {
  const {method, url} = req
  const {pathname} = new URL(url)
  return new Response(`method ${method} not allowed for path ${pathname}`, {status: 405})
}

function hasMethod(req: Request, val: string) {return req.method === val}
function isGet(req: Request) {return hasMethod(req, 'GET')}

export function logErr(err: Error) {
  if (shouldLogErr(err)) console.error(`[afr]`, err)
}

export function shouldLogErr(err: Error) {
  return Boolean(err) && !isCancelErr(err)
}

function isCancelErr(err: unknown) {
  return isInst(err, Error) && (
    err.name === 'AbortError' ||
    err.name === 'ConnectionAborted' ||
    (err.name === 'Http' && err.message.includes('connection closed'))
  )
}

function isNotFoundErr(err: Error) {
  return isInst(err, Error) && err.name === 'NotFound'
}

async function resOk(res: Response) {
  const {ok, status} = res
  if (ok) return res

  const body = await res.text()
  throw Error(`non-OK response${status ? ` (code ${status})` : ''}: ${body}`)
}

export type ResBody = AnyData | string

function resBody(res: Response): Promise<ResBody> {
  const type = res.headers.get('content-type')
  if (type && /\bapplication[/]json\b/.test(type)) {
    return res.json()
  }
  return res.text()
}

function resOkBody(res: Response): Promise<ResBody> {
  return resOk(res).then(resBody)
}

function parseArgs(args: string[]) {
  valid(args, isArr)
  args = args.slice()

  const opts: Dict = {}

  while (args.length) {
    const arg = args.shift()!

    const flagReg = /^--(\w+)$/
    const match = arg.match(flagReg)
    if (!match) throw Error(`expected flag like "--arg", found ${show(arg)}`)

    const key = match[1]

    if (!args.length) throw Error(`expected value following flag ${show(arg)}`)
    opts[key] = maybeJsonParse(args.shift())
  }

  return opts as unknown as MainOpts
}

function maybeJsonParse<R extends AnyData>(val?: string): typeof val extends string ? R : (string | undefined) {
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
function fsEventKindToType(kind: Deno.FsEvent['kind']): WatchType {
  valid(kind, isStr)
  return kind === 'modify' ? 'change' : kind
}

// WHATWG streams have non-idempotent close, throwing on repeated calls.
// We have multiple code paths / callbacks leading to multiple calls.
function streamClose(ctrl?: ReadableStreamDefaultController) {
  try {ctrl?.close()}
  catch (err) {ignore(err)}
}

function ignore(_err: Error) {}

if (import.meta.main) mainWithArgs(Deno.args)
