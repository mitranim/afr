## Overview

`afr`: **A**lways **Fr**esh. Tiny Node.js library that:

* Watches files.
* Reinjects CSS without reloading.
* Reloads pages on other changes.
* Serves files. (Optionally with `.html` and `index.html` fallbacks.)

Other features:

* One small file, dependency-free. Being small is a big feature!
* Not a separate server. Runs from _within_ your Node server, without complicating your environment.
* Can signal page reload _after server restart_. Extremely useful when developing a server-rendered app.
  * Implemented via tiny daemon, controllable via tiny bundled CLI.
* Flexible directory configuration: multiple paths with filters, separate for file serving and file watching.

Super-lightweight alternative to Browsersync and Livereload. Also replaces `node-static` for files.

## TOC

* [Why](#why)
* [Usage](#usage)
  * [High Level](#high-level)
  * [Normal Server](#normal-server)
  * [Server Restart Signal](#server-restart-signal)
  * [File Serving](#file-serving)
  * [Notes on Proxying](#notes-on-proxying)
* [API](#api)
  * [`class Aio`](#class-aio)
  * [`class Broadcaster`](#class-broadcaster)
  * [`class Dir`](#class-dir)
  * [`class Dirs`](#class-dirs)
  * [`class Watcher`](#class-watcher)
  * [`function serveFile`](#servefileres-httpcode-fspath)
  * [Daemon Funs](#daemon-funs)
  * [Vars](#vars)
* [CLI](#cli)
* [Known Limitations](#known-limitations)
* [Misc](#misc)

## Why

This library is born from frustrations with Browsersync and other related tools. Advantages:

* Extremely small and simple.
* No dependencies (rather than **tens of megabytes** in BS).
* Doesn't require its own server; plugs into yours.
* Silent, doesn't spam your terminal with crap.
* No delays in the file watcher or anywhere else.
* Compatible with plain Node servers. **No** Express/Connect junk.
* Injected CSS doesn't have long-ass names.
* Failing webpage requests don't get stuck loading forever.
* Doesn't prevent you from proxying websockets.
* Reliable: if the server is running, the client is connected.
* Can signal page reload after server restart.
* ... probably more that I'm forgetting to mention.

## Usage

```sh
npm i -ED afr
```

Afr must be inited in two places: Node.js and your HTML markup.

To enable automatic page reload or CSS reinject, append one of these to your HTML. Which one, depends on how you start Afr. See the API below. Note that `type="module"` is required.

```html
<script type="module" src="/afr/client.mjs"></script>
<script type="module" src="http://localhost:23456/client.mjs"></script>
```

You can optionally specify `?key=some-key` in the script URL. Clients with a key will ignore server messages without the matching key.

### High Level

High-level shortcut. This will serve and watch all files in one directory. The "handle site" method will automatically look for `.html` and `index.html` fallbacks, like many static servers including GitHub Pages. The client will reinject CSS or reload the page on changes to the watched files.

Client code:

```html
<script type="module" src="/afr/client.mjs"></script>
```

Server code:

```js
import * as http from 'http'
import * as afr from 'afr'

const srv = new http.Server()
const aio = new afr.Aio()

aio.serve('public')
aio.watch('public')

srv.listen(0, onListen)
srv.on('request', aio.handleSiteOr404)

function onListen(err) {afr.onListen(srv, err)}
```

### Normal Server

Afr never "runs" a server. It creates objects acting as request handlers. You decide where to call them, from within your own stack of request handlers / routes.

Client code:

```html
<script type="module" src="/afr/client.mjs"></script>
```

Server code:

```js
import * as http from 'http'
import * as afr from 'afr'

const srv = new http.Server()
const aio = new afr.Aio()

aio.serve('public')
aio.watch('public')

srv.listen(0, onListen)
srv.on('request', onRequest)

function onListen(err) {afr.onListen(srv, err)}

function onRequest(req, res) {
  // Serves the client script or handles the client data uplink.
  // If true, the request is handled, and you should leave it alone.
  if (aio.handle(req, res)) return

  // Your own handling.
  res.writeHead(404)
  res.end('not found')
}
```

### Server Restart Signal

When restarting the server (via an external watch tool such as `watchexec`), it's extremely useful to reload the client immediately after server start. No earlier, no later. Afr lets you do that.

To make this work, your server will start a tiny persistent daemon, and you must load the Afr client script from the daemon's local address, rather than your server's address.

Client code:

```html
<script type="module" src="http://localhost:23456/client.mjs"></script>
```

Server code:

```js
import * as http from 'http'

const srv = new http.Server()
const dirs = afr.dirs(afr.dir('public'))

srv.listen(0, onListen)
srv.on('request', someRequestHandling)

function onListen(err) {
  // Print startup msg + address.
  afr.onListen(srv, err)

  // Start a tiny Afr daemon (default address `http://localhost:23456`).
  afr.daemonStart()

  // Notify clients, auto-reload pages.
  afr.daemonMaybeSend(afr.change)

  // Notify the daemon's clients on changes to the given dirs.
  dirs.watchMsg(afr.wat(), {}, afr.daemonMaybeSend)
}

function ignore() {}
```

Also see [CLI](#cli) for daemon commands.

### File Serving

Afr can either watch files, serve files, or both. These features are completely orthogonal. Both are related to the [`Dir`](#class-dir) and [`Dirs`](#class-dirs) APIs.

This example configuration will serve files from several directories, matching them in this order. For the `.` directory, it will serve only the files whose path, relative to the CWD, matches the given regexp. It will not serve anything else.

There are other file-serving methods; check the API reference. For development, it should be perfectly sufficient. For production, use a real file server like Nginx.

```js
const pubDirs = afr.dirs(
  afr.dir('target'),
  afr.dir('static'),
  afr.dir('.', /^(?:images|scripts|node_modules)[/]/),
)

async function onRequest(req, res) {
  if (await pubDirs.handleFile(req, res)) return

  // Your own handling.
  res.writeHead(404)
  res.end('not found')
}
```

### Notes on Proxying

Afr doesn't include special proxy support because it merely provides request handlers for your server. For many apps, this already eliminates the need for proxies!

## API

Some less-important APIs are undocumented, to avoid bloating the docs. Check `afr.mjs` and look for `exports`. Note that many useful APIs are methods on classes such as [`Aio`](#class-aio) and [`Dirs`](#class-dirs).

### `class Aio`

Short for "all-in-one". Shortcut that combines `Watcher`, `Broadcaster`, and `Dirs` into one package, convenient for jumpstarting a site/app. See [High Level](#high-level) for an example.

Any options passed to `Aio` are passed to its internal `Broadcaster`.

### `class Broadcaster`

Lower-level tool dedicated to serving `client.mjs` and maintaining client data uplinks. Used internally by other tools.

```js
const bro = afr.broad()

function onRequest(req, res) {
  // Either serve the client script, or store the connection
  // for later broadcasts.
  if (bro.handle(req, res)) return

  // Your own handling.
  res.writeHead(404)
  res.end('not found')
}

// Broadcast a message to all connected clients.
bro.send(afr.change)

// Close all current connections.
bro.deinit()
```

The option `namespace` (default `/afr`) controls the base URL path for Afr's endpoints (client script and event notifications). If `/afr` conflicts with your own endpoint, pass a different namespace, and change the pathname in the client script:

```js
const bro = afr.broad({namespace: '/development/afr'})
```

```html
<script type="module" src="/development/afr/client.mjs"></script>
```

### `class Dir`

Fundamental tool for file serving and watching. Essentially a filter. Should usually be combined with others into `Dirs`, see below.

Matches all files in the directory:

```js
const dir = afr.dir('public')
```

Matches only the files that pass the filter. The filter may be a regexp or a function.

```js
const dir = afr.dir('.', /^(?:static|images|styles)/)
```

### `class Dirs`

Fundamental tool for file serving and watching. Collection of `Dir` objects that can serve or watch in aggregate.

Example:

```js
// Dirs for serving, but not watching.
const pubDirs = afr.dirs(
  afr.dir('target'),
  afr.dir('static'),
  afr.dir('.', /^(?:images|scripts|node_modules)[/]/),
)

// Dirs for watching, but not serving.
const watchDirs = afr.dirs(
  afr.dir('scripts'),
  afr.dir('static'),
  afr.dir('target'),
)

async function onListen(err) {
  afr.onListen(srv, err)

  // See the example "Server Restart Signal" for an explanation.
  afr.daemonStart()
  afr.daemonMaybeSend(afr.change)

  // On changes to these dirs, notify connected clients.
  // This may reinject CSS or reload pages.
  watchDirs.watchMsg(afr.wat(), {}, afr.daemonMaybeSend)
}

async function onRequest(req, res) {
  // Try to serve a file from any of the specified directories, falling back
  // on `.html` and `index.html` if possible. You can also use `handleFile`
  // to avoid the fallbacks.
  //
  // If true, a file has been found and served.
  if (await pubDirs.handleSite(req, res)) return

  // Your own handling.
  res.writeHead(404)
  res.end('not found')
}
```

### `class Watcher`

Lower-level tool for watching multiple directories. It exists because Node currently doesn't have such an API built-in. `fs.watch` takes only one directory, and the watcher it returns can't "add" more. `Watcher` fills this gap: call `.watch` to add more, and `.deinit` to close all.

```js
const wat = afr.wat()

wat.watch('target', {}, onFsEvent)
wat.watch('static', {}, onFsEvent)
wat.deinit()

function onFsEvent(type, path) {}
```

Instead of this, you should probably make [`Dirs`](#class-dirs) and call `dirs.watch` or `dirs.watchMsg`.

### `serveFile(res, httpCode, fsPath)`

Serves a specific file, with the given HTTP status code. Unlike all other file-serving APIs in this library, this one is not speculative: the file must really exist, otherwise you get an error.

To handle a file request speculatively, use `Dir` or `Dirs` and call `.handleFile()` instead.

Guesses `content-type` from the file extension, using the `contentTypes` dictionary, which you can monkey-patch. Doesn't set any other headers.

```js
async function onRequest(req, res) {
  try {
    await afr.serveFile(res, 200, `index.html`)
  }
  catch (err) {
    res.writeHead(500)
    res.end(err.stack)
  }
}
```

### Daemon Funs

The following functions can control Afr's tiny daemon from inside your Node process:

* `daemonExists(opts)`
* `daemonRestart(opts)`
* `daemonSend(body, opts)`
* `daemonMaybeSend(body, opts)`
* `daemonStart(opts)`
* `daemonStop(opts)`

All of them are async (return promises). The names should be self-explanatory. They're also exposed via Afr's [CLI](#cli); run `npx afr` for help.

`opts` are optional, and may contain `port` and `timeout`. For sending, opts may also contain `key`. Clients ignore messages whose key doesn't match theirs. This allows multiple apps, connected to the same local daemon, to ignore each other's change notifications. Key is provided to clients by appending `?key=some-key` to the client script URL:

```html
<script type="module" src="http://localhost:23456/client.mjs"></script>
<script type="module" src="http://localhost:23456/client.mjs?key=some-app"></script>
```

In server code, you mostly want the following:

```js
const dirs = afr.dirs(afr.dir('some-dir'), afr.dir('more-dir'))

function onListen(err) {
  afr.onListen(srv, err)
  afr.daemonStart()
  afr.daemonMaybeSend(afr.change)
  dirs.watchMsg(afr.wat(), {}, afr.daemonMaybeSend)
}
```

### Vars

#### `change`

Simplest possible message that causes clients to reload.

#### `contentTypes`

Dictionary of common file extensions and their content types. Embedded in `afr` to avoid dependencies. Monkey-patch it to support more types.

```js
Object.assign(afr.contentTypes, {
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
})
```

#### `defaultPort`

Port on which Afr's optional daemon listens by default. Used by the various daemon funs if port is unspecified.

## CLI

Afr comes with a tiny CLI (`npx afr`) that lets you check, start, restart, or "talk" to the daemon. It's less than 100 LoC and doesn't incur any dependencies.

This should work out of the box:

```sh
npx afr
```

`npx` is stupidly slow to start. To make this faster, add the following to your shell's pro-file:

```sh
export PATH="$PATH:node_modules/.bin"
```

Then you can run scripts like Afr's CLI directly, and faster:

```sh
afr
```

## Known Limitations

Afr is really geared towards being run from inside your Node server. As such, it doesn't currently implement the feature of restarting the server _itself_. This must be done by an external tool, such as `watchexec`. This may change in the future.

As stated elsewhere in the documentation, Afr's file-serving features are probably not production-grade. It simplifies your environment, but for production, you should serve files via something like Nginx.

## Changelog

### `0.2.1`

Corrected minor race condition in CSS replacement.

### `0.2.0`

Now an extra-powerful all-in-one.

## License

https://unlicense.org

## Misc

I'm receptive to suggestions. If this library _almost_ satisfies you but needs changes, open an issue or chat me up. Contacts: https://mitranim.com/#contacts
