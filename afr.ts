#!/usr/bin/env -S deno run --allow-net --allow-read --unstable

/* global Deno */

import {main as clientMain} from './client.mjs'

/* Public API (partially un/documented) */

export const contentTypes: Readonly<Record<string, string>> = {
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

export const change = {type: 'change'} as const

export type SendOpts = LocParams & Omit<RequestInit, 'method' | 'body'>

export function send(body: WatchResItem, opts: SendOpts): Promise<Record<string, unknown> | string> {
  valid(body, isDict)
  valid(opts, isDict)

  const url = new URL('send', loc(opts))
  const fetchOpts: RequestInit = {headers: jsonHeaders, ...opts, method: 'POST', body: JSON.stringify(body)}

  return fetch(url, fetchOpts).then(resOkBody)
}

export function maybeSend(body: WatchResItem, opts: SendOpts) {
  return send(body, opts).catch(logErr)
}

export type WatchType = Omit<Deno.FsEvent['kind'], 'modify'> | 'change'

export interface WatchOpts {
  signal?: AbortSignal,
  recursive: boolean,
}

export interface WatchResItem {
  type: WatchType,
  path?: string,
}

export async function* watch(target: string, dirs: Dir[], opts?: WatchOpts): AsyncGenerator<WatchResItem> {
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

export async function resFile(req: Request, dirs: Dir[], opts?: ResExactFileOpts) {
  validInst(req, Request)
  if (!isGet(req)) return undefined
  const info = await resolveFile(dirs, req.url)
  return info && resExactFile(info.url, opts)
}

export async function resSite(req: Request, dirs: Dir[], opts?: ResExactFileOpts) {
  validInst(req, Request)
  if (!isGet(req)) return undefined
  const info = await resolveSiteFile(dirs, req.url)
  return info && resExactFile(info.url, opts)
}

export async function resSiteNotFound(req: Request, dirs: Dir[], opts?: ResExactFileOpts) {
  validInst(req, Request)
  validOpt(opts, isDict)
  if (!isGet(req)) return undefined
  const info = await resolveFile(dirs, '404.html')
  return info && resExactFile(info.url, {...opts, status: 404})
}

export async function resSiteWithNotFound(req: Request, dirs: Dir[], opts?: ResExactFileOpts) {
  validInst(req, Request)
  return (await resSite(req, dirs, opts)) || (await resSiteNotFound(req, dirs, opts))
}

export function resolve(dirs: Dir[], url: string | URL) {
  return procure(dirs, dirResolve, url)
}

async function resolveFile(dirs: Dir[], url: string | URL) {
  return (await resolve(dirs, url))?.onlyFile()
}

export function resolveSiteFile(dirs: Dir[], url: string | URL) {
  return procure(dirs, dirResolveSiteFile, url)
}

export interface ResExactFileOpts extends ResponseInit, ReadableStreamFromReaderOpts {}

export async function resExactFile(path: string | URL, opts?: ResExactFileOpts) {
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
  const path = isInst(url, URL) ? url.pathname : url;
  return contentTypes[ext(path)]
}

export function clientPath(opts: LocParams) {
  return new URL('client.mjs', loc(opts))
}

export function dir(path: string, test?: DirTest) {return new Dir(path, test)}

export type DirTest = RegExp | ((path: string) => boolean)

export class Dir {
  private readonly url: URL
  private readonly test?: DirTest

  constructor(path: string, test?: DirTest) {
    validOpt(test, isTest)
    this.url = dirUrl(path, this.base())
    this.test = test
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
    if (isFun(test)) return test(path)
    if (isReg(test)) return test.test(path)
    return true
  }

  rel(url: URL) {
    validInst(url, URL)
    return decodeURIComponent(trimPrefix(url.pathname, this.url.pathname))
  }
}

export interface BroadParams {
  namespace?: string,
  verbose?: boolean,
}

export class Broad extends Set<BroadClient> {
  private readonly verbose?: boolean
  private readonly url: URL
  private readonly urlClient: URL
  private readonly urlEvents: URL
  private readonly urlEvent: URL
  private readonly urlSend: URL

  constructor({namespace = defaultNamespace, verbose}: BroadParams = {}) {
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

  async send(msg: Uint8Array) {
    for (const client of this) await client.write(msg)
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

  resVia<C extends new (bro: Broad, sig: AbortSignal) => BroadClient>(
    req: Request,
    Client: C,
    opts?: ResponseInit
  ) {
    const sig = req.signal
    if (sig?.aborted) return undefined
    return new Response(new Client(this, sig), opts)
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

  deinit(msg: Record<string, unknown>) {
    validOpt(msg, isDict)
    msg = {type: 'deinit', ...msg}

    for (const val of this) {
      val.writeObj(msg)
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

interface MainParams extends BroadParams, Deno.ListenOptions { }

export async function main({namespace, hostname = defaultHostname, verbose, ...opts}: MainParams) {
  const bro = new Broad({namespace, verbose})
  const listener = Deno.listen({hostname, ...opts})

  if (verbose && isNetAddr(listener.addr)) {
    console.log(`[afr] listening on http://${hostname || 'localhost'}:${listener.addr.port}`)
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

  for await (const conn of listener) serveHttp(conn).catch(logErr)
}

function isNetAddr(addr: Deno.Addr): addr is Deno.NetAddr {
  return ['tcp', 'udp'].includes(addr.transport);
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
export async function* watchFs(target: string, opts?: WatchOpts) {
  const sig = opts?.signal
  const iter = Deno.watchFs(target, opts)
  const deinit = iter.close.bind(iter)

  try {
    sig?.addEventListener('abort', deinit, {once: true})
    for await (const event of iter) yield event
  }
  finally {
    sig?.removeEventListener('abort', deinit)
    iter.close()
  }
}

type StreamResObj = Uint8Array

export class ReadWriter extends ReadableStream<StreamResObj> {
  private readonly ctrl?: ReadableStreamDefaultController<StreamResObj>

  constructor(opts?: UnderlyingSource<StreamResObj>) {
    let ctrl: ReadableStreamDefaultController<StreamResObj> | undefined = undefined
    let self: this | undefined = undefined

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

  write(val: Uint8Array) {return this.ctrl?.enqueue(val)}

  writeObj(val: Record<string, unknown>) {
    this.write(enc.encode(JSON.stringify(val)))
  }

  // WHATWG streams have non-idempotent close, throwing on repeated calls.
  // We have multiple code paths / callbacks leading to multiple calls.
  deinit() {
    try {this.ctrl?.close()}
    catch (err) {ignore(err)}
  }
}

export class BroadClient extends ReadWriter {
  private readonly bro: Broad
  private readonly sig: AbortSignal

  constructor(bro: Broad, sig: AbortSignal, opts?: UnderlyingSource<StreamResObj>) {
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
  writeObj(val: Record<string, unknown>) {
    super.writeObj(val)
    this.deinit()
  }
}

export class EventStreamClient extends BroadClient {
  writeObj(val: Record<string, unknown>) {
    this.write(enc.encode(`data: ${JSON.stringify(val) || ''}\n\n`))
  }
}

export class FsInfo {
  readonly url: URL
  readonly stat: Deno.FileInfo

  constructor(url: URL, stat: Deno.FileInfo) {
    validInst(url, URL)
    valid(stat, isComp)

    this.url = url
    this.stat = stat
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
    || false
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
  Fn extends (dir: Dir, ...args: [A1]) => Promise<FsInfo | undefined | false>,
  A1
>(
  dirs: Dir[],
  fun: Fn,
  ...args: [A1]
): Promise<FsInfo | undefined> {
  validEachInst(dirs, Dir)
  valid(fun, isFun)

  for (const dir of dirs) {
    const val = await fun(dir, ...args)
    if (val) return val
  }

  return undefined
}

export interface ReadableStreamFromReaderOpts { chunkSize?: number }

export function readableStreamFromReader(reader: Deno.Reader & Deno.Closer, opts?: ReadableStreamFromReaderOpts) {
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

function add(a: string, b: string) {return a + b}

type AnyFn = (...args: unknown[]) => unknown
// deno-lint-ignore no-explicit-any
type AbstractConstructor = abstract new(...args: any[]) => unknown
type Test<Val> = (val: Val) => boolean

function isNil(val: unknown): val is null | undefined {return val == null}
function isStr(val: unknown): val is string     {return typeof val === 'string'}
function isNum(val: unknown): val is number     {return typeof val === 'number'}
function isInt(val: unknown): val is number     {return isNum(val) && ((val % 1) === 0)}
function isNatPos(val: unknown): val is number  {return isInt(val) && val > 0}
function isFun<Fn extends AnyFn>(val: unknown): val is Fn {
  return typeof val === 'function'
}
function isObj(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object'
}
function isArr<R extends Array<unknown>>(val: unknown): val is R {
  return isInst(val, Array)
}
function isReg(val: unknown): val is RegExp {
  return isInst(val, RegExp)
}
function isComp<
  Fn extends AnyFn = AnyFn
>(val: unknown) {
  return isObj(val) || isFun<Fn>(val)
}
function isTest<Fn extends AnyFn = AnyFn>(val: unknown) {return isFun<Fn>(val) || isReg(val)}
function isInst<C extends AbstractConstructor>(val: unknown, Cls: C): val is InstanceType<C> {return isComp(val) && val instanceof Cls}

function isDict<R extends Record<string, unknown> = Record<string, unknown>>(val: unknown): val is R {
  if (!isObj(val)) return false
  const proto = Object.getPrototypeOf(val)
  return proto === null || proto === Object.prototype
}


function valid<Val>(val: Val, test: Test<Val>) {
  if (!isFun(test)) throw TypeError(`expected validator function, got ${show(test)}`)
  if (!test(val)) invalid(val, test)
}

function validOpt<Val>(val: Val, test: Test<Val>) {
  if (!isNil(val)) valid(val, test)
}

function validEachInst<C extends AbstractConstructor>(vals: unknown[], Cls: C) {
  valid(vals, isArr)
  vals.forEach((v) => validInst(v, Cls))
}

function invalid<Val>(val: Val, test: Test<Val>) {
  throw TypeError(`expected ${show(val)} to satisfy test ${show(test)}`)
}

function validInst<C extends AbstractConstructor>(val: unknown, Cls: C) {
  if (!isInst(val, Cls)) {
    const cons = isObj(val) ? val?.constructor : null
    throw TypeError(`expected ${show(val)}${cons ? ` (instance of ${show(cons)})` : ``} to be an instance of ${show(Cls)}`)
  }
}

function validInstOpt(val: unknown, Cls: AbstractConstructor) {
  valid(Cls, isFun)
  if (!isNil(val)) validInst(val, Cls)
}

function show(val: unknown) {
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

export interface LocParams {
  url?: string | URL,
  port: number,
  hostname?: string,
  namespace?: string,
}

export function loc({url, port, hostname = defaultHostname, namespace = defaultNamespace}: LocParams) {
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
function urlMut<Fn extends (pathname: string, ...args: [A1]) => string, A1>(url: URL, fun: Fn, ...args: [A1]): URL;
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

export function ignore(_err: Error) {}

function nopRes() {return new Response()}

export function errRes(err: Error) {
  const msg = (
    err
    && (
      err.stack || err.message
      || /* FIXME: what kind of error should return 'code'? */ (err as unknown as { code: string }).code
    )
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

function resBody(res: Response): Promise<Record<string, unknown> | string> {
  const type = res.headers.get('content-type')
  if (type && /\bapplication[/]json\b/.test(type)) {
    return res.json()
  }
  return res.text()
}

function resOkBody(res: Response): Promise<Record<string, unknown> | string> {
  return resOk(res).then(resBody)
}

function parseArgs(args: string[]) {
  valid(args, isArr)
  args = args.slice()

  const opts: Record<string, unknown> = {}

  while (args.length) {
    const arg = args.shift()!

    const flagReg = /^--(\w+)$/
    if (!flagReg.test(arg)) throw Error(`expected flag like "--arg", found ${show(arg)}`)
    const key = arg.match(flagReg)![1]

    if (!args.length) throw Error(`expected value following flag ${show(arg)}`)
    opts[key] = maybeJsonParse(args.shift())
  }

  return opts as unknown as MainParams
}

function maybeJsonParse<R extends Record<string, unknown>>(val?: string): (typeof val) extends string ? R : string | undefined {
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

if (import.meta.main) mainWithArgs(Deno.args)
