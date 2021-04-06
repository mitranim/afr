/*
Running this example:

  node examples/only-files.mjs

There will be 404 errors for `client.mjs` because `index.html` is the same
for all examples, but this example doesn't use any server-watcher features,
only file serving. This is expected.
*/

import * as http from 'http'
import * as afr from '../afr.mjs'

const srv = new http.Server()
const dirs = afr.dirs(afr.dir('examples'))

srv.listen(54172, onListen)
srv.on('request', dirs.handleSiteOr404)

function onListen(err) {afr.onListen(srv, err)}
