'use strict'

const nd = require('../')

const ds = new nd.Devserver()
ds.watchFiles('./')
ds.serveFiles('./')
ds.listen(64734)
