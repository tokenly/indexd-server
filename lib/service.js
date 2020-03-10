let indexd = require('indexd')
let leveldown = require('leveldown')
let qup = require('qup')
let rpc = require('./rpc')
let zmq = require('zeromq/v5-compat')

let debug = require('debug')('service')
let debugZmq = require('debug')('zmq')
let debugZmqTx = require('debug')('zmq:tx')
let debugZmqBlock = require('debug')('zmq:block')
console.error(`test`)
module.exports = function initialize (callback) {
  function errorSink (err) {
    if (err) debug(err)
  }

  console.error(`Init leveldb @ ${process.env.INDEXDB}`)
  let db = leveldown(process.env.INDEXDB)
  let adapter = new indexd(db, rpc)

  if (!process.env.INCLUDE_SUPERFLUOUS_INDEXES) {
    // Remove unwanted indexes (we don't use these in production)
    delete adapter.indexes.fee
    delete adapter.indexes.mtp
  }

  db.open({
    writeBufferSize: 1 * 1024 * 1024 * 1024,
    cacheSize: 64 * 1024 * 1024
  }, (err) => {
    if (err) return callback(err, adapter)
    console.error(`Opened leveldb @ ${process.env.INDEXDB}`)

    let zmqSock = zmq.socket('sub')

    zmqSock.on('connect', () => {
      console.error('connected')
    })

    zmqSock.on('close', () => {
      console.error('Connection closed, reconnecting')
      connect()
    })
    zmqSock.on('disconnected', () => {
      console.error('Disconnected, reconnecting')
      connect()
    })
    zmqSock.on('monitor_error', () => {
      zmqSock.monitor(500, 0)
    })
    zmqSock.monitor(500, 0)

    let lastSequence = {}
    zmqSock.on('message', (topic, message, sequence) => {
      topic = topic.toString('utf8')
      message = message.toString('hex')
      sequence = sequence.readUInt32LE()

      // if any ZMQ messages were lost,  assume a resync is required
      if (lastSequence[topic] !== undefined && (sequence !== (lastSequence[topic] + 1))) {
        console.error(`${sequence - lastSequence[topic] - 1} messages lost`)
        lastSequence[topic] = sequence
        adapter.tryResync(errorSink)
      }
      lastSequence[topic] = sequence

      // resync every block
      if (topic === 'hashblock') {
        console.error(topic, message)
        return adapter.tryResync(errorSink)
      } else if (topic === 'hashtx') {
        console.error(topic, message)
        return adapter.notify(message, errorSink)
      }
    })

    let connect = () => {
      zmqSock.connect(process.env.ZMQ)
      zmqSock.subscribe('hashblock')
      zmqSock.subscribe('hashtx')
    }


    connect()

    for (let i = 0; i < process.argv.length; i++) {
      if (process.argv[i] === '--resync' && process.argv.length > i) {
        let blockHash = process.argv[i + 1]

        rpc('getblockheader', [blockHash], (err, data) => {
          if (err) {
            console.error(err)
            throw err
          } else {
            adapter.connectFrom(blockHash, data.previousblockhash, (err, res) => {
              if (err) {
                console.error('Error while resync', err)
              } else {
                console.error('Resync done')
              }
            })
          }
        })

        break
      }
    }

    adapter.tryResync(errorSink)
    adapter.tryResyncMempool(errorSink)
    callback(null, adapter)
    setInterval(() => {
      // This interval is set as a fallback just in case ZMQ is misbehaving
      adapter.tryResync(errorSink)
      adapter.tryResyncMempool(errorSink)
    }, 60000)

  })
}
