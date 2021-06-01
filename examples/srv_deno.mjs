import * as hs from 'https://deno.land/std@0.97.0/http/server.ts'
import * as a from '../afr_deno.mjs'

const srvOpts = {port: 34567, hostname: 'localhost'}
const afrOpts = {port: 34566}
const dirs = [a.dir('.', /[.]html|css$/)]

async function main() {
  const srv = hs.serve(srvOpts)
  console.log(`[srv] listening on http://${srvOpts.hostname}:${srvOpts.port}`)
  watch()
  for await (const req of srv) respond(req)
}

async function watch() {
  a.maybeSend(a.change, afrOpts)
  for await (const msg of a.watch('.', dirs, {recursive: true})) {
    await a.send(msg, afrOpts)
  }
}

async function respond(req) {
  if (await a.serveSiteWithNotFound(req, dirs)) return
  await req.respond({status: 404, body: 'not found'})
}

main()
