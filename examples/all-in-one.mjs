/*
Running this example:

  node examples/all-in-one.mjs
*/

import * as http from 'http'
import * as afr from '../afr.mjs'

const srv = new http.Server()
const aio = new afr.Aio()

aio.serve('examples')
aio.watch('examples')

srv.listen(54172, onListen)
srv.on('request', aio.handleSiteOr404)

function onListen(err) {afr.onListen(srv, err)}
