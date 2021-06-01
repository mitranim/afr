#!/usr/bin/env node

// Node/NPM need this because Node lacks `import.meta.main`. We use the
// `process.argv[1]` workaround, but it appears to be unreliable.
//
// Deno has `import.meta.main` and doesn't need this.

import {main} from './afr_node.mjs'
import {runMain} from './afr_shared.mjs'

runMain(main, process.argv.slice(2))
