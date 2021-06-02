## Overview

`afr`: **A**lways **Fr**esh. Tiny library for [Node](https://nodejs.org) and [Deno](https://deno.land) that:

* Reloads pages on changes.
* Reinjects CSS without reloading.
* Optionally serves files.
  * Optionally just like GitHub Pages.

Two components:

* Server component:
  * Used inside your server, or via optional CLI.
  * Notifies clients.
  * Notification can be triggered by HTTP request from another process.
    * Allows page reload _immediately_ after server restart. See [`examples`](tree/master/examples).
* Client component:
  * Tiny [script](blob/master/client.mjs).
  * Listens for server notifications.
  * Reinjects CSS without reloading. Reloads on other changes.

Other features:

* Tiny and dependency-free. Being small is a big feature!
  * Caveat: invoking optional Deno CLI imports some stdlib modules. This is completely skippable.
* Doesn't force a separate server. Runs from _within_ your Node/Deno server, without complicating your environment. Optionally, run separately via CLI.
* Can signal page reload _after server restart_. Extremely useful when developing a server-rendered app.
  * Implemented by running in a separate process, sending notifications from your main server process.
  * Accepts signals over HTTP, which can be sent from any process, from any language.
* Serves static files with a flexible directory configuration. Allows multiple paths with filters.

Super-lightweight alternative to Browsersync, Livereload, and file-serving libraries.

## TOC

* [Why](#why)
* [Usage](#usage)
  * [As Library](#as-library)
  * [Node CLI](#node-cli)
  * [Deno CLI](#deno-cli)
* [Examples](#examples)
* [API](#api)
  * [`class Broad`](#class-broadopts)
  * [`class Dir`](#class-dirpath-filter)
  * [`function send`](#function-sendmsg-opts)
  * [`function maybeSend`](#function-maybesendmsg-opts)
  * [`function watch`](#function-watchpath-dirs-opts)
  * [`function serveFile`](#function-servefile)
  * [`function serveSite`](#function-servesite)
  * [`function serveSiteWithNotFound`](#function-servesitewithnotfound)
  * [`function serveExactFile`](#function-serveexactfile)
  * [Undocumented](#undocumented)
* [Known Limitations](#known-limitations)
* [Misc](#misc)

## Why

This library is born from frustrations with Browsersync and other related tools. Advantages:

* Very small, simple, fast.
* No dependencies, rather than customary **tens of megabytes**.
  * Caveat: invoking optional Deno CLI imports some stdlib modules.
* Doesn't require its own server; plugs into yours.
  * Doesn't infect your stack with junk.
  * Doesn't prevent you from proxying websockets.
* Silent, doesn't spam your terminal with crap.
* No forced delays.
* Compatible with plain Node servers. **No** Express/Connect junk.
* Compatible with plain Deno servers. **No** framework junk.
  * Caveat: assumes stdlib server. At the time of writing, `Deno.serveHttp` is too immature. This may change in the future.
* Injected CSS doesn't have long-ass names.
* Failing webpage requests don't get stuck forever.
* Reliable: if the server is running, the client is connected.
* Can reload pages immediately after server restart.
* Built-in file server.
  * Optionally compatible with GitHub Pages rules.
* ... probably more that I'm forgetting to mention.

## Usage

### As Library

In Node, via NPM:

```sh
npm i -ED afr
```

```js
import * as a from 'afr'
```

In Deno, by URL:

```js
import * as a from 'https://unpkg.com/afr@<version>/afr_deno.mjs'
```

### Node CLI

In Node, Afr CLI can be invoked by `npx`:

```sh
npx afr --help
npx afr --port 23456 --verbose true
```

`npx` is stupidly slow, so I recommend bypassing it:

  * Unix: add `export PATH="$PATH:./node_modules/.bin"` to your shell pro-file (usually `~/.profile` or `~/.bash_profile`).
  * Windows: add `.\node_modules\.bin` to your `%PATH%` via System Properties → Advanced → Environment Variables.

After reloading your env variables, this lets you invoke CLIs, installed locally by NPM, directly without `npx`:

```sh
afr --help
afr --port 23456 --verbose true
```

You can also:

```sh
node node_modules/afr/afr_node.mjs --help
node node_modules/afr/afr_node.mjs --port 23456 --verbose true
```

### Deno CLI

In Deno, there's no specialized CLI shortcut. Just run the "main" file:

```sh
deno run --allow-net --allow-read https://unpkg.com/afr@<version>/afr_deno.mjs --help
deno run --allow-net --allow-read https://unpkg.com/afr@<version>/afr_deno.mjs --port 23456 --verbose true
```

## Examples

For runnable examples: clone this repo, `cd` to [`examples`](tree/master/examples), and run `make`.

## API

### `class Broad(opts)`

Short for "broadcaster". Handles Afr clients:

  * Serves `client.mjs`.
  * Maintains persistent connections from clients waiting for notifications.
  * Broadcasts notifications to those clients.

The constructor takes the following options:

```ts
interface BroadOpts {
  // URL pathname prefix for all Afr endpoints, including the client script.
  namespace?: string = '/afr/';
}
```

In Node:

```js
const bro = new a.Broad()

async function respond(req, res) {
  if (await bro.respond(req, res)) return

  // Your own request handling.
  res.end('ok')
}

// Broadcasts a reload signal to all clients.
async function change() {
  await bro.send({type: 'change'})
}
```

In Deno (stdlib server):

```js
const bro = new a.Broad()

// Broadcasts a reload signal to all clients.
await bro.send({type: 'change'})

async function respond(req) {
  if (await bro.respond(req)) return

  // Your own request handling.
  await req.respond({body: 'ok'})
}

// Broadcasts a reload signal to all clients.
async function change() {
  await bro.send({type: 'change'})
}
```

Running Afr as a CLI starts an HTTP server that handles all requests using a [`Broad`](#class-broadopts) instance and responds with 404 to everything unknown.

### `class Dir(path, filter)`

Fundamental tool for serving files and handling FS events. Takes an FS path and an optional filter. For example:

```js
const dir = a.dir('target', /[.]html|css|mjs$/)
```

Many Afr functions require an array of dirs:

```js
const dirs = [
  a.dir('target'),
  a.dir('.', /[.]html|css|mjs$/),
]
```

The filter may be either a regexp or a function. Afr applies it to a path that is Posix-style (`/`-separated), relative to the dir, and _not_ URL-encoded. Dirs without a filter are permissive and "allow" any sub-path when asked.

```js
const dirs = [
  a.dir('target'),
  a.dir('.', /^static|images|scripts[/]/),
]
```

### `function send(msg, opts)`

Broadcasts `msg` to Afr clients. Assumes that on `opts.url` or `opts.hostname + opts.port` there is a reachable server that handles requests using [`Broad`](#class-broadopts) instance, and makes an HTTP request that causes that broadcaster to relay `msg`, as JSON, to every connected client.

```ts
interface SendOpts {
  url?: URL;
  port?: number;
  hostname?: string;
  namespace?: string;
}
```

This is useful when running Afr and your own server in separate processes. This allows clients to stay connected when your server restarts, and immediately reload when it's ready.

See the [`examples`](tree/master/examples) folder for runnable Node and Deno examples using this pattern.

```js
const afrOpts = {port: 23456}
const dirs = [a.dir('target')]

// Call this when your server starts.
async function watch() {
  // May cause connected clients to immediately reload.
  a.maybeSend(a.change, afrOpts)

  // Watch files and notify clients about changes that don't involve restarting
  // the server, for example in CSS files.
  for await (const msg of a.watch('target', dirs, {recursive: true})) {
    await a.send(msg, afrOpts)
  }
}
```

### `function maybeSend(msg, opts)`

Same as [`send`](#function-sendmsg-opts), but ignores any connection errors.

### `function watch(path, dirs, opts)`

Wraps `'fs/promises'.watch` (Node) or `Deno.watchFs` (Deno), converting FS events into messages understood by `client.mjs`.

`path` and `opts` are passed directly to the underlying FS watch API. `dirs` must be an array of [`Dir`](#class-dirpath-filter); they're used to convert absolute FS paths to relative URL paths, and to filter events via `dir.allow`.

To ignore certain paths, use dir filters; see [`Dir`](#class-dirpath-filter).

The resulting messages can be broadcast to connected clients via `bro.send` (when using a [broadcaster](#class-broadopts) in the same process) or [`send`](#function-sendmsg-opts) (when using an external process).

For cancelation, pass `opts.signal` which must be an `AbortSignal`, and later abort it. In Deno, you can also call `.return()` on the resulting iterator.

Example:

```js
const dirs = [a.dir('target'), a.dir('.', /[.]mjs$/)]

for await (const msg of a.watch('.', dirs, {recursive: true})) {
  await a.send(msg, afrOpts)
}
```

### `function serveFile`

Signature in Node: `serveFile(req, res, dirs, opts)`.

Signature in Deno: `serveFile(req, dirs, opts)`.

Tries to find and serve a file specified by `req.url`. Asynchronously returns `true` if a file was successfully found and served, otherwise `false`.

`dirs` must be an array of [`Dir`](#class-dirpath-filter). They're used as simultaneously mount points and whitelist. For each dir, `req.url` is resolved relative to that directory, and only the paths "allowed" by its filter may be served. Unlike most file-serving libraries, this allows you to easily and _safely_ serve files out of `.`. In addition, this will automatically reject paths containing `..`.

Has limited `content-type` detection. If `opts.headers` don't already include `content-type`, tries to guess it by file extension. Known content types are stored in the `contentTypes` dictionary (exported but undocumented), which you can import and mutate.

In Node:

```js
const dirs = [a.dir('target'), a.dir('.', /[.]html$/)]

async function respond(req, res) {
  if (await a.serveFile(req, res, dirs)) return

  res.writeHead(404)
  res.end('not found')
}
```

In Deno:

```js
const dirs = [a.dir('target'), a.dir('.', /[.]html$/)]

async function respond(req) {
  if (await a.serveFile(req, dirs)) return
  await req.respond({status: 404, body: 'not found'})
}
```

### `function serveSite`

Signature in Node: `serveSite(req, res, dirs, opts)`.

Signature in Deno: `serveSite(req, dirs, opts)`.

Same as [`serveSiteWithNotFound`](#function-servesitewithnotfound), but without the `404.html` fallback.

### `function serveSiteWithNotFound`

Signature in Node: `serveSiteWithNotFound(req, res, dirs, opts)`.

Signature in Deno: `serveSiteWithNotFound(req, dirs, opts)`.

Variant of [`serveFile`](#function-servefile) that mimics GitHub Pages, Netlify, and other static-site hosting providers, by trying additional fallbacks when no exact match is found:

  * Try appending `.html`, unless the URL already looks like a file request or ends with `/`.
  * Try appending `/index.html`, unless the URL already looks like a file request.
  * Try serving `404.html` with status code 404.

Extremely handy for developing a static site to be served by providers such as GitHub. Check [`examples`](tree/master/examples) for runnable examples.

Asynchronously returns `true` if a file was successfully found and served, otherwise `false`.

In Node:

```js
const dirs = [a.dir('target'), a.dir('.', /[.]html$/)]

async function respond(req, res) {
  if (await a.serveSiteWithNotFound(req, res, dirs)) return

  res.writeHead(404)
  res.end('not found')
}
```

In Deno:

```js
const dirs = [a.dir('target'), a.dir('.', /[.]html$/)]

async function respond(req) {
  if (await a.serveSiteWithNotFound(req, dirs)) return
  await req.respond({status: 404, body: 'not found'})
}
```

### `function serveExactFile`

Signature in Node: `serveExactFile(req, res, path, opts)`.

Signature in Deno: `serveExactFile(req, path, opts)`.

Lower-level tool used by other file-serving functions. Serves a specific file, which _must_ exist in the FS. `path` is anything accepted by the underlying Node/Deno API for opening files; it may be a relative FS path, absolute FS path, or file URL.

If the file was found and served, returns `true` for consistency with other file-serving functions. Otherwise, throws an exception.

Has limited `content-type` detection; see [`serveFile`](#function-servefile) for notes.

**Warning**: this may blindly serve **any** file from the filesystem. _Never_ pass externally-provided paths such as `req.url` to this function. This must be used _only_ for paths that are safe to publicly expose. For serving arbitrary files from a folder, use [`serveFile`](#function-servefile) or [`serveSite`](#function-servesite).

In Node:

```js
async function respond(req, res) {
  if (await a.serveFile(req, res, 'index.html')) return
  if (await a.serveFile(req, res, '404.html', {status: 404})) return

  res.writeHead(404)
  res.end('not found')
}
```

In Deno (stdlib server):

```js
async function respond(req) {
  if (await a.serveFile(req, 'index.html')) return
  if (await a.serveFile(req, '404.html', {status: 404})) return
  await req.respond({status: 404, body: 'not found'})
}
```

### Undocumented

Some APIs are exported but undocumented to avoid bloating the docs. Check the source files and look for `export`.

## Known Limitations

The Deno version assumes you're using the "stdlib" HTTP server. `Deno.serveHttp` is not supported because:

* Responses require a `ReadableStream`; files from `Deno.open` don't implement that yet. We could technically shim it, but that's not our job.

* Could buffer files in RAM, but feels too dirty.

* `req.signal` is not implemented; unclear if we can close files in _all_ cases.

Afr's file-serving features are probably not production-grade. It does take measures to prevent unauthorized access, and does stream instead of buffering, but doesn't support caching headers and etags. However, Afr _does_ expose the lower-level tools allowing you to implement smart, fine-grained caching headers yourself. You can combine `resolveFile` / `serveFsInfo` / `serveExactFile` (some undocumented), adding caching headers based on each file's location and FS info. Different apps might have different caching strategies for different assets. A one-size-fits-all solution provided by most file-serving libraries is usually not the best strategy.

## Changelog

### `0.3.2`

Improved the timing of the first response over a new HTTP connection when running via CLI in Node on Windows.

### `0.3.1`

In Deno, when loading/running Afr by URL, `Broad` should now be able to serve the client script.

### `0.3.0`

* Support both Node and Deno.
* Removed daemon features. Run Afr in foreground, in parallel with your server. Use Make to orchestrate build tasks and sub-processes.
* Removed `Watcher` class; use `watch` to iterate over FS messages.
* Removed `Aio`.
* Removed `Dirs`.
* Moved IO methods from `Dirs` and `Dir` into plain functions, with some minor renaming.

### `0.2.3`

File server corrections for Windows compatibility (for real this time).

### `0.2.2`

File server corrections for Windows compatibility.

### `0.2.1`

Corrected minor race condition in CSS replacement.

### `0.2.0`

Now an extra-powerful all-in-one.

## License

https://unlicense.org

## Misc

I'm receptive to suggestions. If this library _almost_ satisfies you but needs changes, open an issue or chat me up. Contacts: https://mitranim.com/#contacts
