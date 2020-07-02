//
// mediasoup_sample
//   https://github.com/mganeko/mediasoup_v3_example
//   mediasoup_v3_example is provided under MIT license
//
//   This sample is using https://github.com/versatica/mediasoup
//
//   Thanks To:
//     - https://lealog.hateblo.jp/entry/2019/03/25/180850
//     - https://lealog.hateblo.jp/entry/2019/02/25/144511
//     - https://github.com/leader22/mediasoup-demo-v3-simple/tree/master/server
//     - https://github.com/mkhahani/mediasoup-sample-app
//     - https://github.com/daily-co/mediasoup-sandbox
// 
// install
//   npm install socket.io
//   npm install express
//   npm install socket.io
//   npm install mediasoup@3
//   npm install mediasoup-client@3
//   npm install browserify
// or
//   npm install
//
// setup
//   npm run build-client
//
// run
//   npm run loopback

'use strict';

// --- read options ---
const scribbles = require('scribbles');
const fs = require('fs');
const serverOptions = require('./serverOptions');

let sslOptions = {};
if (serverOptions.useHttps) {
  sslOptions.key  = fs.readFileSync(serverOptions.httpsKeyFile ).toString();
  sslOptions.cert = fs.readFileSync(serverOptions.httpsCertFile).toString();
}

// --- prepare server ---
const http = require("http");
const https = require("https");
const express = require('express');

const app = express();
const webPort = serverOptions.listenPort;
app.use(express.static('public'));

let webServer = null;
if (serverOptions.useHttps) {
    scribbles.log("https")
  // -- https ---
  webServer = https.createServer(sslOptions, app)
                   .listen(webPort, function () {
    scribbles.log('Web server start. https://' + serverOptions.hostName + ':' + webServer.address().port + '/');
  });
}
else {
  scribbles.log("http")
  // --- http ---
  webServer = http.Server(app)
                  .listen(webPort, function () {
    scribbles.log('Web server start. http://' + serverOptions.hostName + ':' + webServer.address().port + '/');
  });
}

// --- file check ---
/*function isFileExist(path) {
  try {
    fs.accessSync(path, fs.constants.R_OK);
    //scribbles.log('File Exist path=' + path);
    return true;
  }
  catch (err) {
    if (err.code === 'ENOENT') {
      //scribbles.log('File NOT Exist path=' + path);
      return false
    }
  }

  scribbles.error('MUST NOT come here');
  return false;
}*/
//scribbles.log(webServer.address())
// --- socket.io server ---
const io = require('socket.io')(webServer);
scribbles.log('socket.io server start. port=' + webServer.address().port);

//=====================================================
//==================================== io.on connection
//=====================================================

io.on('connection', function (socket) {
  scribbles.log('client connected. socket id=' + socket.id + '  , total clients=' + getClientCount());

//+++++++++++++++++++++++++++++++++++++++++ disconnect
//++++++++++++++++++++++++++++++++++++++++++++++++++++

  socket.on('disconnect', function () {
    // close user connection
    scribbles.log('client disconnected. socket id=' + socket.id + '  , total clients=' + getClientCount());
    cleanUpPeer(socket);
  });
  
//++++++++++++++++++++++++++++++++++++++++++++++ error
//++++++++++++++++++++++++++++++++++++++++++++++++++++

  socket.on('error', function (err) {
    scribbles.error('socket ERROR:', err);
  });
  
//++++++++++++++++++++++++++++++++++++++ connect error
//++++++++++++++++++++++++++++++++++++++++++++++++++++

  socket.on('connect_error', (err) => {
    scribbles.error('client connection error', err);
  });

//++++++++++++++++++++++++ get Router Rtp Capabilities
//++++++++++++++++++++++++++++++++++++++++++++++++++++

  socket.on('getRouterRtpCapabilities', (data, callback) => {
    if (router) {
      scribbles.log('getRouterRtpCapabilities: ', router.rtpCapabilities);
      sendResponse(router.rtpCapabilities, callback);
    }
    else {
      sendReject({ text: 'ERROR- router NOT READY' }, callback);
    }
  });

//++++++++++++++++++++++++++ create Producer Transport
//++++++++++++++++++++++++++++++++++++++++++++++++++++

  socket.on('createProducerTransport', (data, callback) => {
    scribbles.log('-- createProducerTransport ---',data);
    createTransport().then(({ transport, params })=>{
        
        producerTransport = transport;
        producerTransport.observer.on('close', () => {
          if (videoProducer) {
            videoProducer.close();
            videoProducer = null;
          }
          if (audioProducer) {
            audioProducer.close();
            audioProducer = null;
          }
          producerTransport = null;
        });
        //scribbles.log('-- createProducerTransport params:', params);
        sendResponse(params, callback);
      
      })
  });

//+++++++++++++++++++++++++ connect Producer Transport
//++++++++++++++++++++++++++++++++++++++++++++++++++++

  socket.on('connectProducerTransport', (data, callback) => {
    producerTransport.connect({ dtlsParameters: data.dtlsParameters })
                     .then(()=>{
      sendResponse({}, callback);
    }).catch(err => { scribbles.error(err); throw err})
    
  });

//++++++++++++++++++++++++++++++++++++++++++++ produce
//++++++++++++++++++++++++++++++++++++++++++++++++++++

  socket.on('produce', ({ kind, rtpParameters }, callback) => {
    
    scribbles.log('-- produce --- kind=', kind);
    
    if ( ! ['video','audio'].includes(kind)) {
      scribbles.error('produce ERROR. BAD kind:', kind);
      //sendResponse({}, callback);
      return;
    }
    
    producerTransport.produce({ kind, rtpParameters })
                     .then(mProducer => {
                          if (kind === 'video')
                            videoProducer = mProducer
                          else
                            audioProducer = mProducer
                          
                          mProducer.observer.on('close', () => { scribbles.log(kind+'Producer closed ---'); })
                          sendResponse({ id: mProducer.id }, callback);
                          
                          // inform clients about new producer
    scribbles.log('--broadcast newProducer -- kind=', kind);
                          socket.broadcast.emit('newProducer', { kind: kind });
                          if (consumerTransport) {
    scribbles.log('-- emit newProducer --')
                            socket.emit('newProducer', { kind: kind }); // send back too
                          }
                          else {
    scribbles.log('consumerTransport is NULL:', consumerTransport);
                          }
                          
                      }).catch(err=>{
    scribbles.error(err)
                        throw err
                      })
  });


//++++++++++++++++++++++++++ create Consumer Transport
//++++++++++++++++++++++++++++++++++++++++++++++++++++

  socket.on('createConsumerTransport', async (data, callback) => {
    scribbles.log('-- createConsumerTransport ---');
    createTransport().then(({ transport, params })=>{
      consumerTransport = transport;
      consumerTransport.observer.on('close', () => {
        scribbles.log('-- consumerTransport closed ---');
        if (videoConsumer) {
          videoConsumer.close();
          videoConsumer = null;
        }
        if (audioConsumer) {
          audioConsumer.close();
          audioConsumer = null;
        }
        consumerTransport = null;
      });
      //scribbles.log('-- createTransport params:', params);
      sendResponse(params, callback);
    }).catch(err=>{
    scribbles.error(err)
              throw err
            })
  });

//+++++++++++++++++++++++++ connect Consumer Transport
//++++++++++++++++++++++++++++++++++++++++++++++++++++

  socket.on('connectConsumerTransport', async (data, callback) => {
    scribbles.log('-- connectConsumerTransport ---');
    await consumerTransport.connect({ dtlsParameters: data.dtlsParameters });
    sendResponse({}, callback);
  });

//++++++++++++++++++++++++++++++++++++++++++++ consume
//++++++++++++++++++++++++++++++++++++++++++++++++++++

  socket.on('consume', async (data, callback) => {
    const kind = data.kind;
    scribbles.log('-- consume --kind=' + kind);

    if (kind === 'video') {
      if (videoProducer) {
        const { consumer, params } = await createConsumer(videoProducer, data.rtpCapabilities); // producer must exist before consume
        videoConsumer = consumer;
        scribbles.log('-- consumer ready ---');
        sendResponse(params, callback);
      }
      else {
        scribbles.log('-- consume, but video producer NOT READY');
        const params = { producerId: null, id: null, kind: 'video', rtpParameters: {} };
        sendResponse(params, callback);
      }
    }
    else if (kind === 'audio') {
      if (audioProducer) {
        const { consumer, params } = await createConsumer(audioProducer, data.rtpCapabilities); // producer must exist before consume
        audioConsumer = consumer;
        scribbles.log('-- consumer ready ---');
        sendResponse(params, callback);
      }
      else {
        scribbles.log('-- consume, but audio producer NOT READY');
        const params = { producerId: null, id: null, kind: 'audio', rtpParameters: {} };
        sendResponse(params, callback);
      }
    }
    else {
      scribbles.error('ERROR: UNKNOWN kind=' + kind);
    }
  });

//+++++++++++++++++++++++++++++++++++++++++++++ resume
//++++++++++++++++++++++++++++++++++++++++++++++++++++

  socket.on('resume', ({kind}, callback) => {
    
    scribbles.log('-- resume -- kind=' + kind);
    
    if (kind !== 'video') {
      scribbles.warn('NO resume for audio');
      return
    }
    
    videoConsumer.resume().then(()=>sendResponse({}, callback)).catch(err => { scribbles.error(err); throw err})
  
  }); // END socket.on('resume'

  // ---- sendback welcome message with on connected ---
  //const newId = getId(socket);
  sendback(socket, { type: 'welcome', id: socket.id });

  // --- send response to client ---
  function sendResponse(response, callback) {
    //scribbles.log('sendResponse() callback:', callback);
    callback(null, response);
  }

  // --- send error to client ---
  function sendReject(error, callback) {
    callback(error.toString(), null);
  }

  function sendback(socket, message) {
    socket.emit('message', message);
  }
});
/*
function getId(socket) {
  return socket.id;
}*/

//=====================================================
//====================================== getClientCount
//=====================================================

function getClientCount() {
  // WARN: undocumented method to get clients number
  return io.eio.clientsCount;
}

//=====================================================
//========================================= cleanUpPeer
//=====================================================

function cleanUpPeer(socket) {
  //const id = getId(socket);

  if (videoConsumer) {
    videoConsumer.close();
    videoConsumer = null;
  }
  if (audioConsumer) {
    audioConsumer.close();
    audioConsumer = null;
  }
  if (consumerTransport) {
    consumerTransport.close();
    consumerTransport = null;
  }

  if (videoProducer) {
    videoProducer.close();
    videoProducer = null;
  }
  if (audioProducer) {
    audioProducer.close();
    audioProducer = null;
  }

  if (producerTransport) {
    producerTransport.close();
    producerTransport = null;
  }
}

// ========= mediasoup ===========
const mediasoup = require("mediasoup");
const mediasoupOptions = {
  // Worker settings
  worker: {
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
    logLevel: 'warn',
    logTags: [
      'info',
      'ice',
      'dtls',
      'rtp',
      'srtp',
      'rtcp',
      // 'rtx',
      // 'bwe',
      // 'score',
      // 'simulcast',
      // 'svc'
    ],
  },
  // Router settings
  router: {
    mediaCodecs:
      [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2
        },
        {
          kind: 'video',
          mimeType: 'video/VP8',
          clockRate: 90000,
          parameters:
          {
            'x-google-start-bitrate': 1000
          }
        },
      ]
  },
  // WebRtcTransport settings
  webRtcTransport: {
    listenIps: [
      { ip: serverOptions.hostName, announcedIp: serverOptions.hostName }
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    maxIncomingBitrate: 1500000,
    initialAvailableOutgoingBitrate: 1000000,
  }
};

let worker = null;
let router = null;
let producerTransport = null;
let videoProducer = null;
let audioProducer = null;
let consumerTransport = null;
let videoConsumer = null;
let audioConsumer = null;

function startWorker() {
  mediasoup.createWorker()
           .then(worker => worker.createRouter({ mediaCodecs : mediasoupOptions.router.mediaCodecs}))
           .then(result => {
             router = result
           //producerTransport = await router.createWebRtcTransport(mediasoupOptions.webRtcTransport);
             scribbles.log('-- mediasoup worker start. --')
           }).catch(err => { scribbles.error(err); throw err})
}

startWorker();

//
// Room {
//   id,
//   transports[],
//   consumers[],
//   producers[],
// }
//

/*--
function getTransport() {
  if (!producerTransport) {
    scribbles.error('ERROR: producerTransport NOT READY');
    return;
  }

  return {
    producerTransport,
    params: {
      id: producerTransport.id,
      iceParameters: producerTransport.iceParameters,
      iceCandidates: producerTransport.iceCandidates,
      dtlsParameters: producerTransport.dtlsParameters
    },
  };
}
--*/

//=====================================================
//==================================== create Transport
//=====================================================

function createTransport() {
 return router.createWebRtcTransport(mediasoupOptions.webRtcTransport)
              .then(transport => {
                scribbles.log('-- create transport id=' + transport.id);
                
                return {
                  transport: transport,
                  params: {
                    id: transport.id,
                    iceParameters: transport.iceParameters,
                    iceCandidates: transport.iceCandidates,
                    dtlsParameters: transport.dtlsParameters
                  } // END params
                } // END return
              }) // END .then
	.catch(err => { scribbles.error(err); throw err})
} // END createTransport


//=====================================================
//===================================== create Consumer
//=====================================================

function createConsumer(producer, rtpCapabilities) {
  let consumer = null;
  const producerId = producer.id
  
  if ( ! router.canConsume({ producerId, rtpCapabilities })) {
    scribbles.error('can not consume');
    return;
  } // END ! router.canConsume

  //consumer = await producerTransport.consume({ // NG: try use same trasport as producer (for loopback)
  return consumerTransport.consume({ // OK
    producerId: producer.id,
    rtpCapabilities,
    paused: producer.kind === 'video',
  })
  .then(consumer => ({
    //if (consumer.type === 'simulcast') {
    //  await consumer.setPreferredLayers({ spatialLayer: 2, temporalLayer: 2 });
    //}
    consumer,
    params: {
         producerId,
                 id: consumer.id,
               kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
               type: consumer.type,
     producerPaused: consumer.producerPaused
    }
  }))
  .catch(err => {
    scribbles.error('consume failed', err);
    return;
  });

} // END createConsumer


