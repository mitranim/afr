import * as a from '../afr.mjs'

const afrOpts = {port: 34566}
const srvOpts = {port: 34567, hostname: 'localhost'}
const dirs = [a.dir('.', /[.]html|css$/)]

async function main() {
  const lis = Deno.listen(srvOpts)
  console.log(`[srv] listening on http://${srvOpts.hostname || 'localhost'}:${srvOpts.port}`)
  watch()
  for await (const conn of lis) serveHttp(conn)
}

async function watch() {
  a.maybeSend(a.change, afrOpts)
  for await (const msg of a.watch('.', dirs, {recursive: true})) {
    a.maybeSend(msg, afrOpts)
  }
}

async function serveHttp(conn) {
  for await (const event of Deno.serveHttp(conn)) {
    respond(event).catch(a.logErr)
  }
}

async function respond(event) {
  if (await a.serveSiteWithNotFound(event, dirs)) return
  await event.respondWith(new Response('not found', {status: 404}))
}

main()
