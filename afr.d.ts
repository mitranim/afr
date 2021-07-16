export const contentTypes: Readonly<Record<string, string>>

export const change: WatchResItem

type SendOpts = LocParams & Omit<RequestInit, 'method' | 'body'>

export function send<T>(body: WatchResItem, opts?: SendOpts): Promise<T>

export const maybeSend: typeof send;

type WatchType = Omit<Deno.FsEvent, 'modify'> & 'change'

interface WatchOpts {
  signal?: AbortSignal,
  recursive: boolean,
}

interface WatchResItem {
  type: WatchType,
  path?: string,
}

export function watch(target: string, dirs: Dir[], opts?: WatchOpts): AsyncGenerator<WatchResItem>

interface ResExactFileOpts extends ResponseInit, ReadableStreamFromReaderOpts {}

export function resFile(req: Request, dirs: Dir[], opts?: ResExactFileOpts): Promise<Response | undefined>
export const resSite: typeof resFile
export const resSiteNotFound: typeof resFile
export const resSiteWithNotFound: typeof resFile

export function resolve(dirs: Dir[], url: URL): Promise<FsInfo | undefined>
export const resolveFile: typeof resolve
export const resolveSiteFile: typeof resolve

export function resExactFile(path: string | URL, opts: ResExactFileOpts): Response

export function contentType(path: string | URL): string

export function clientPath(opts: LocParams): URL

export function dir(path: string, test?: DirTest): Dir

type DirTest = RegExp | ((path: string) => boolean)

export class Dir {
  constructor(path: string, test?: DirTest)

  base(): URL

  resolveUrl(url: string | URL): URL

  allowUrl(url: string): boolean

  allow(path: string): boolean

  rel(url: URL): string
}

interface BroadParams {
  namespace?: string,
  verbose?: boolean,
}

export class Broad extends Set<BroadClient> {
  constructor(params?: BroadParams)

  get [Symbol.toStringTag](): string
  get EventClient(): EventClient
  get EventStreamClient(): EventStreamClient

  base(): string

  send(msg: Uint8Array): Promise<any>

  resOr404(req: Request): Response
  res(req: Request): Response | undefined
  resClient(req: Request): Response
  resEvents(req: Request): Response | undefined
  resEvent(req: Request): Response | undefined
  resVia(req: Request, Client: BroadClient, opts?: ResponseInit): Response | undefined

  resSend(req: Request): Promise<Response>

  add(val: BroadClient): this

  clear(): void

  deinit(msg: Uint8Array): void
}

interface MainParams extends BroadParams, Deno.ListenOptions { }

export function main(params: MainParams): Promise<void>

export function mainWithArgs(args: string[]): Promise<void>

export function watchFs(target: string, opts: WatchOpts): AsyncGenerator<Deno.FsEvent>

export class ReadWriter extends ReadableStream<Uint8Array> {
  constructor(opts?: UnderlyingSource<Uint8Array>)

  write(chunk: Uint8Array): void

  deinit(): void
}

export class BroadClient extends ReadWriter {
  constructor(bro: Broad, sig: AbortSignal, opts?: UnderlyingSource<Uint8Array>)

  handleEvent(event: Event): void

  deinit(): void
}

export class EventClient extends BroadClient {}

export class EventStreamClient extends BroadClient {}

export class FsInfo {
  constructor(url: URL, stat: Deno.FileInfo)

  onlyFile(): this | undefined
}

export function dirResolve(dir: Dir, url: URL): Promise<FsInfo | undefined>
export const dirResolveFile: typeof dirResolve

export function dirResolveSiteFile(dir: Dir, url: URL): Promise<FsInfo | false>

export function fsMaybeStat(path: string | URL): Promise<Deno.FileInfo | undefined>

export function procure<
  Fn extends <Res>(dir: Dir, ...args: [A1, A2, A3, A4, A5, A6, A7, A8, A9]) => Res,
  A1, A2, A3, A4, A5, A6, A7, A8, A9
>(
  dirs: Dir[],
  fun: Fn,
  ...args: [A1?, A2?, A3?, A4?, A5?, A6?, A7?, A8?, A9?]
): Promise<ReturnType<Fn> | undefined>

interface ReadableStreamFromReaderOpts { chunkSize?: number }

export function readableStreamFromReader(reader: Deno.Reader, opts?: ReadableStreamFromReaderOpts): ReadableStream<Uint8Array>

interface LocParams {
  url?: string | URL,
  port: number,
  hostname?: string,
  namespace?: string,
}

export function loc(params: LocParams): URL

export function ignore(err: Error): void

export function errRes(err: Error): Response

export function logErr(err: Error): void

export function shouldLogErr(err: Error): boolean


