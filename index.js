// dotenv at CONFIG_FILE or .env
let dotenv = require('dotenv')
require('dotenv').config()

let TESTNET = (process.env.TESTNET === '1' || (process.env.TESTNET && process.env.TESTNET.toLowerCase() === 'true'))
let REGTEST = (process.env.REGTEST === '1' || (process.env.REGTEST && process.env.REGTEST.toLowerCase() === 'true'))

if (TESTNET && REGTEST) {
  throw new Error('Cannot specify REGTEST and TESTNET at the same time')
}


let debug = require('debug')('index')
let express = require('express')
let service = require('./lib/service')
let api = require('./lib/express')

let app = express()

let cors = require('cors')
if (process.env.CORS === '*') {
  app.use(cors())
} else if (process.env.CORS) {
  app.use(cors({ origin: process.env.CORS }))
}

// run the service
console.error(`Initializing blockchain connection${["", " (for testnet)", " (for regtest)"][(TESTNET?1:0)+(REGTEST?2:0)]}`)
service((err, adapter) => {
  if (err) {
    return console.error('Initialization failed:', err)
  }

  // start the API server
  console.error('starting API server')
  app.use(api(adapter, {testnet: TESTNET, regtest: REGTEST, custom: process.env.CUSTOM}))
  app.listen(process.env.SERVER_PORT);
  console.error("App listening on port "+process.env.SERVER_PORT);
})
