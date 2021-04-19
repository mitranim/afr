#!/usr/bin/env node

process.title = 'afr'

import * as afr from '../afr.mjs'

const cmds = new Map([
  ['help',             {fun: help,                  descr: `this message`}],
  ['daemon-exists',    {fun: afr.daemonExists,      descr: `is daemon running`}],
  ['daemon-start',     {fun: afr.daemonStart,       descr: `start daemon if not running`}],
  ['daemon-stop',      {fun: afr.daemonStop,        descr: `stop daemon if running`}],
  ['daemon-restart',   {fun: afr.daemonRestart,     descr: `restart daemon if running`}],
  ['daemon-send',      {fun: afr.daemonSend,        descr: `send to daemon (broadcast to clients)`}],
  ['server-start',     {fun: afr.daemonServerStart, descr: `run daemon server in foreground`}],
  ['echo',             {fun: echo,                  descr: `print parsed opts`}],
])

void async function main() {
  try {
    const {cmd, opts} = parseArgs(process.argv.slice(2))
    if (!cmd) {
      console.log(help())
      process.exit(1)
    }

    const known = cmds.get(cmd)

    if (!known) {
      console.log(`
    Unrecognized command "${cmd}". ${help()}
    `.trim())
      process.exit(1)
    }

    const {fun} = known
    console.log(await fun(opts))
  }
  catch (err) {
    console.error(err)
    process.exit(1)
  }
}()

function help() {
  const width = [...cmds.keys()].reduce((acc, key) => Math.max(acc, key.length), 0)
  const hints = [...cmds.entries()].map(entry => cmdHint(entry, width))

  return `
Usage:

${hints.join(`\n`)}

Daemon commands take --port (default ${afr.defaultPort}).
`.trim()
}

function cmdHint([key, {descr}], width) {
  return `  afr ${key.padEnd(width)} -- ${descr}`
}

function echo(opts) {return opts}

function parseArgs([cmd, ...args]) {
  const opts = {}
  const optReg = /^--(\w+)$/

  while (args.length) {
    const arg = args.shift()

    if (!optReg.test(arg)) throw Error(`expected flag like "--arg", found ${arg}`)
    const key = arg.match(optReg)[1]

    if (!args.length) throw Error(`expected value following flag "${arg}"`)
    opts[key] = maybeJsonParse(args.shift())
  }

  return {cmd, opts}
}

function maybeJsonParse(val) {
  try {
    return JSON.parse(val)
  }
  catch (err) {
    if (err.name === 'SyntaxError') return val
    throw err
  }
}
