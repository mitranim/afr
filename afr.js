'use strict'

const ch = require('chokidar')
const fs = require('fs')
const ht = require('http')
const ns = require('node-static')
const pt = require('path')
const ur = require('url')
const ws = require('ws')

const PATH_PREFIX = '/afr'
const WS_PATH = PATH_PREFIX + '/ws'
const CLIENT_SCRIPT_PATH = PATH_PREFIX + '/client.js'
const CLIENT_SCRIPT_FS_PATH = pt.join(__dirname, 'client.js')

class Devserver {
  constructor() {
    this.fileServer = undefined
    this.httpServer = undefined
    this.wsServer   = new ws.Server({noServer: true})
    this.wsClients  = new Set()
    this.fsWatcher  = undefined
  }

  watchFiles(watchPath) {
    if (this.fsWatcher) throw Error(`redundant .watchFiles() call`)
    this.fsWatcher = new ch.FSWatcher()

    const onFsEvent = (type, path) => {
      this.broadcast({type, path: pt.relative(watchPath, path), fileType: fileType(path)})
    }

    this.fsWatcher
      .add(watchPath)
      .on('add',    onFsEvent.bind(undefined, 'changed'))
      .on('change', onFsEvent.bind(undefined, 'changed'))
      .on('rename', onFsEvent.bind(undefined, 'renamed'))
      .on('unlink', onFsEvent.bind(undefined, 'deleted'))
  }

  serveFiles(path) {
    if (this.fileServer) throw Error(`redundant .serveFiles() call`)
    this.fileServer = new ns.Server(path)
    delete this.fileServer.options.headers.server
  }

  listen(port, callback) {
    if (this.httpServer) throw Error(`redundant .listen() call`)

    this.httpServer = new ht.Server()
    this.httpServer.on('request', this.onRequest.bind(this))
    this.httpServer.on('upgrade', this.onUpgrade.bind(this))

    const onListen = callback || (err => {
      if (err) throw err
      console.log(`listening on http://localhost:${this.httpServer.address().port}`)
    })
    this.httpServer.listen(port, onListen)
  }

  onRequest(req, res, fallback) {
    if (ur.parse(req.url).pathname === CLIENT_SCRIPT_PATH) {
      if (req.method !== 'GET') {
        res.writeHead(405)
        res.end()
        return
      }
      res.setHeader('content-type', 'text/javascript')
      fs.createReadStream(CLIENT_SCRIPT_FS_PATH).pipe(res)
      return
    }

    if (this.fileServer && (req.method === 'GET' || req.method === 'HEAD')) {
      this.fileServer.serve(req, res).addListener('error', function onFileError() {
        if (fallback) {
          fallback(req, res)
          return
        }
        res.writeHead(404)
        res.end()
      })
      return
    }

    if (fallback) {
      fallback(req, res)
      return
    }
    res.writeHead(404)
    res.end()
  }

  onUpgrade(req, socket, head, fallback) {
    if (ur.parse(req.url).pathname === WS_PATH) {
      const onWsUpgrade = ws => {
        const {wsClients} = this
        wsClients.add(ws)
        ws.on('close', function onWsClose() {
          wsClients.delete(ws)
        })
      }
      this.wsServer.handleUpgrade(req, socket, head, onWsUpgrade)
      return
    }

    if (fallback) {
      fallback(req, socket, head)
      return
    }
    socket.destroy()
  }

  broadcast(message) {
    const encoded = JSON.stringify(message)
    this.wsClients.forEach(function forEachClient(client) {
      client.send(encoded)
    })
  }

  deinit() {
    if (this.fsWatcher) {
      this.fsWatcher.stop()
      this.fsWatcher = undefined
    }

    if (this.httpServer) {
      this.httpServer.close()
      this.httpServer = undefined
    }

    if (this.fileServer) {
      this.fileServer = undefined
    }

    const {wsClients} = this
    wsClients.forEach(function forEachClient(client) {
      wsClients.delete(client)
      client.close()
    })
  }
}
exports.Devserver = Devserver

function fileType(path) {
  if (pt.extname(path) === '.css') return 'stylesheet'
  return undefined
}
