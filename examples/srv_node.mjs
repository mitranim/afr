import * as ht from 'http'
import * as ut from 'util'
import * as a from '../afr_node.mjs'

const afrOpts = {port: 34566}
const srvOpts = {port: 34567}
const dirs = [a.dir('.', /[.]html|css$/)]

const srv = new ht.Server()
srv.on('request', respond)

async function main() {
  await ut.promisify(srv.listen).call(srv, srvOpts.port)
  console.log(`[srv] listening on http://localhost:${srvOpts.port}`)
  watch()
  await ut.promisify(srv.once).call(srv, 'close')
}

async function watch() {
  a.maybeSend(a.change, afrOpts)
  for await (const msg of a.watch('.', dirs, {recursive: true})) {
    await a.send(msg, afrOpts)
  }
}

async function respond(req, res) {
  if (await a.serveSiteWithNotFound(req, res, dirs)) return
  res.writeHead(404)
  res.end('not found')
}

main()
