/*
Running this example:

  node examples/daemon.mjs

(TODO different client script path in HTML files. Currently this example doesn't
work because the client script is not loaded.)
*/

import * as http from 'http'
import * as afr from '../afr.mjs'

const srv = new http.Server()
const pubDirs = afr.dirs(afr.dir('examples'))
const watchDirs = afr.dirs(afr.dir('.', /^((?!node_modules).)*$/))

srv.listen(54172, onListen)
srv.on('request', onRequest)

function onListen(err) {
  afr.onListen(srv, err)
  afr.daemonStart()
  afr.daemonMaybeSend(afr.change)
  watchDirs.watchMsg(afr.wat(), {}, afr.daemonMaybeSend)
}

async function onRequest(req, res) {
  if (await pubDirs.handleSite(req, res)) return

  res.writeHead(404)
  res.end('not found')
}
