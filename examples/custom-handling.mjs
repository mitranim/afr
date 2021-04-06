/*
Running this example:

  node examples/custom-handling.mjs

Then goto `/index.html` in browser.
*/

import * as http from 'http'
import * as afr from '../afr.mjs'

const srv = new http.Server()
const aio = new afr.Aio()

aio.serve('examples')
aio.watch('examples')

srv.listen(54172, onListen)
srv.on('request', onRequest)

function onListen(err) {afr.onListen(srv, err)}

async function onRequest(req, res) {
  if (await aio.handleFile(req, res)) return

  res.writeHead(404)
  res.end('not found')
}
