## Overview

`afr`: **A**lways **Fr**esh. Simple development server for web applications. Serves files, watches files, reinjects CSS, reloads pages.

Lightweight alternative to Browsersync and Livereload.

## Why

This library is born from frustrations with Browsersync. Advantages:

* Extremely small and simple
* Few dependencies: < 1 MB rather than **tens of megabytes**
* Silent, doesn't spam your terminal with crap
* No delays in the file watcher or anywhere else
* Compatible with plain Node servers, no Express/Connect junk
* Can be used in your own server without starting another
* Injected CSS doesn't have long-ass names

## Installation and Usage

```sh
npm i -ED afr
```

In your build script:

```js
const afr = require('afr')

const ds = new afr.Devserver()
ds.watchFiles('./public')
ds.serveFiles('./public')
ds.listen(36590)
```

Append this to your HTML. This enables page updates on file changes.

```html
<script>document.write('<script src="'+window.location.origin+'/afr/client.js"><'+'/script>')</script>
```

## Proxying

Most web clients connect to an API server via HTTP or websockets. For various reasons, requests are usually made to `/` and routed to the server(s) by something like nginx or Kubernetes ingress. In development, you also need proxying and routing.

`afr` doesn't include special support for proxying because it doesn't force you to use its internal server. Instead, it becomes part of yours:

```js
const server = new require('http').Server()
const ds = new require('afr').Devserver()
const proxy = require('http-proxy').createProxyServer()

ds.watchFiles('./public')
ds.serveFiles('./public')
// Note: there's no .listen() call; it doesn't actually start a server.

server.on('request', onRequest) // HTTP request
server.on('upgrade', onUpgrade) // websocket request

server.listen(36590, function onListen(err) {
  if (err) throw err
  console.log(`listening on http://localhost:${server.address().port}`)
})

function onRequest(req, res) {
  if (shouldProxyToApiServer) {
    proxy.web(req, res, {target: myApiServerUrl})
    return
  }
  ds.onRequest(req, res)
}

function onUpgrade(req, socket, head) {
  ds.onUpgrade(req, socket, head, function fallback() {
    proxy.ws(req, socket, head, {target: myApiServerWebsocketUrl})
  })
}

proxy.on('error', function onProxyError(err, req, res) {
  if (err.code === 'ECONNRESET') return
  console.log('[proxy error]', err)
  res.setHeader('content-type', 'application/json')
  res.writeHead(500)
  res.end(JSON.stringify({message: err.message, ...err}))
})
```

### SPA vs. non-SPA

In the example above, we only proxy some HTTP requests and let `afr.Devserver` handle the rest by serving static files or returning 404, a typical SPA setup. If you want `afr.Devserver` to handle only its own endpoints, provide a fallback function:

```js
function onRequest(req, res) {
  ds.onRequest(req, res, function fallback() {
    if (shouldProxyToApiServer) {
      proxy.web(req, res, {target: myApiServerUrl})
      return
    }
    proxy.web(req, res, {target: myOtherServerUrl})
  })
}
```

## API

### `new Devserver()`

Creates a new instance of the devserver. The instance is inert; see the methods below to start it.

### `Devserver.prototype.watchFiles(path)`

Starts watching files at the given path:

```js
ds.watchFiles('./public')
```

Changes in the files will be broadcast to all connected clients. Don't forget to include the client script; see usage examples at the top.

### `Devserver.prototype.serveFiles(path)`

Configures the devserver to serve static files from the given path, which must be a directory. **Doesn't actually start the server**. This is optional; you can skip this and serve static files yourself.

```js
ds.serveFiles('./public')
```

### `Devserver.prototype.listen(port, callback)`

Starts the server on the given port. The callback is optional and receives the startup error, if any.

```js
ds.listen(36590)

// Or

ds.listen(36590, function onListen(err) {
  if (err) throw err
  console.log(`listening on http://localhost:${ds.httpServer.address().port}`)
})
```

To take a random unused port, pass `undefined`:

```js
ds.listen(undefined)

// Or

ds.listen(undefined, function onListen(err) {
  if (err) throw err
  console.log(`listening on http://localhost:${ds.httpServer.address().port}`)
})
```

### `Devserver.prototype.onRequest(req, res, fallback)`

Method for integrating `afr` into your own server. Handles an HTTP request, serving its own endpoints and optionally static files. The optional `fallback` function is called if no matching endpoint or file was found.

Example use. See proxy examples at the top.

```js
const server = new require('http').Server()

server.on('request', onRequest)

function onRequest(req, res) {
  ds.onRequest(req, res, function fallback(req, res) {
    res.end('hello world')
  })
}
```

### `Devserver.prototype.onUpgrade(req, socket, head, fallback)`

Method for integrating `afr` into your own server. Handles a websocket request. Accepts connections from its client script, otherwise calls the optional `fallback` function.

Example use. See proxy examples at the top.

```js
const server = new require('http').Server()
const wserver = new require('ws').Server({noServer: true})

server.on('upgrade', onUpgrade)

function onUpgrade(req, socket, head) {
  ds.onUpgrade(req, socket, head, function fallback(req, socket, head) {
    wserver.handleUpgrade(req, socket, head, function onWsUpgrade(ws) {
      ws.send('hello world')
    })
  })
}
```

When using `afr` with your own server, you must register an `'upgrade'` listener and call this method, otherwise client scripts won't have anything to connect to. Don't forget to include the client script; see usage examples at the top.

### `Devserver.prototype.deinit()`

Stops all activity: HTTP server, file watcher etc.

```js
ds.deinit()
```

## License

https://en.wikipedia.org/wiki/WTFPL

## Misc

I'm receptive to suggestions. If this library _almost_ satisfies you but needs changes, open an issue or chat me up. Contacts: https://mitranim.com/#contacts
