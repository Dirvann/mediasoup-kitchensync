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
//   npm run multiparty

'use strict';

// --- read options ---
const scribbles = require('scribbles');
const fs = require('fs');
const serverOptions = require('./serverOptions');

let sslOptions = {};
if (serverOptions.useHttps) {
  sslOptions.key = fs.readFileSync(serverOptions.httpsKeyFile).toString();
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
  // -- https ---
  webServer = https.createServer(sslOptions, app).listen(webPort, function () {
    scribbles.log('Web server start. https://' + serverOptions.hostName + ':' + webServer.address().port + '/');
  });
}
else {
  // --- http ---
  webServer = http.Server(app).listen(webPort, function () {
    scribbles.log('Web server start. http://' + serverOptions.hostName + ':' + webServer.address().port + '/');
  });
}

// --- file check ---
function isFileExist(path) {
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
}

// --- socket.io server ---
const io = require('socket.io')(webServer);
scribbles.log('socket.io server start. port=' + webServer.address().port);

io.on('connection', function (socket) {
  scribbles.log('client connected. socket id=' + getId(socket) + '  , total clients=' + getClientCount());

  socket.on('disconnect', function () {
    // close user connection
    scribbles.log('client disconnected. socket id=' + getId(socket) + '  , total clients=' + getClientCount());
    cleanUpPeer(socket);
  });
  socket.on('error', function (err) {
    scribbles.error('socket ERROR:', err);
  });
  socket.on('connect_error', (err) => {
    scribbles.error('client connection error', err);
  });

  socket.on('getRouterRtpCapabilities', (data, callback) => {
    if (router) {
      //scribbles.log('getRouterRtpCapabilities: ', router.rtpCapabilities);
      sendResponse(router.rtpCapabilities, callback);
    }
    else {
      sendReject({ text: 'ERROR- router NOT READY' }, callback);
    }
  });

  // --- producer ----
  socket.on('createProducerTransport', async (data, callback) => {
    scribbles.log('-- createProducerTransport ---');
    const { transport, params } = await createTransport();
    addProducerTrasport(getId(socket), transport);
    transport.observer.on('close', () => {
      const id = getId(socket);
      const videoProducer = getProducer(id, 'video');
      if (videoProducer) {
        videoProducer.close();
        removeProducer(id, 'video');
      }
      const audioProducer = getProducer(id, 'audio');
      if (audioProducer) {
        audioProducer.close();
        removeProducer(id, 'audio');
      }
      removeProducerTransport(id);
    });
    //scribbles.log('-- createProducerTransport params:', params);
    sendResponse(params, callback);
  });

  socket.on('connectProducerTransport', async (data, callback) => {
    const transport = getProducerTrasnport(getId(socket));
    await transport.connect({ dtlsParameters: data.dtlsParameters });
    sendResponse({}, callback);
  });

  socket.on('produce', async (data, callback) => {
    const { kind, rtpParameters } = data;
    scribbles.log('-- produce --- kind=' + kind);
    const id = getId(socket);
    const transport = getProducerTrasnport(id);
    if (!transport) {
      scribbles.error('transport NOT EXIST for id=' + id);
      return;
    }
    const producer = await transport.produce({ kind, rtpParameters });
    addProducer(id, producer, kind);
    producer.observer.on('close', () => {
      scribbles.log('producer closed --- kind=' + kind);
    })
    sendResponse({ id: producer.id }, callback);

    // inform clients about new producer
    scribbles.log('--broadcast newProducer ---');
    socket.broadcast.emit('newProducer', { socketId: id, producerId: producer.id, kind: producer.kind });
  });

  // --- consumer ----
  socket.on('createConsumerTransport', async (data, callback) => {
    scribbles.log('-- createConsumerTransport -- id=' + getId(socket));
    const { transport, params } = await createTransport();
    addConsumerTrasport(getId(socket), transport);
    transport.observer.on('close', () => {
      const localId = getId(socket);
      removeConsumerSetDeep(localId);
      /*
      let consumer = getConsumer(getId(socket));
      if (consumer) {
        consumer.close();
        removeConsumer(id);
      }
      */
      removeConsumerTransport(id);
    });
    //scribbles.log('-- createTransport params:', params);
    sendResponse(params, callback);
  });

  socket.on('connectConsumerTransport', async (data, callback) => {
    scribbles.log('-- connectConsumerTransport -- id=' + getId(socket));
    let transport = getConsumerTrasnport(getId(socket));
    if (!transport) {
      scribbles.error('transport NOT EXIST for id=' + getId(socket));
      return;
    }
    await transport.connect({ dtlsParameters: data.dtlsParameters });
    sendResponse({}, callback);
  });

  socket.on('consume', async (data, callback) => {
    scribbles.error('-- ERROR: consume NOT SUPPORTED ---');
    return;
  });

  socket.on('resume', async (data, callback) => {
    scribbles.error('-- ERROR: resume NOT SUPPORTED ---');
    return;
  });

  socket.on('getCurrentProducers', async (data, callback) => {
    const clientId = data.localId;
    scribbles.log('-- getCurrentProducers for Id=' + clientId);

    const remoteVideoIds = getRemoteIds(clientId, 'video');
    scribbles.log('-- remoteVideoIds:', remoteVideoIds);
    const remoteAudioIds = getRemoteIds(clientId, 'audio');
    scribbles.log('-- remoteAudioIds:', remoteAudioIds);

    sendResponse({ remoteVideoIds: remoteVideoIds, remoteAudioIds: remoteAudioIds }, callback);
  });

  socket.on('consumeAdd', async (data, callback) => {
    const localId = getId(socket);
    const kind = data.kind;
    scribbles.log('-- consumeAdd -- localId=%s kind=%s', localId, kind);

    let transport = getConsumerTrasnport(localId);
    if (!transport) {
      scribbles.error('transport NOT EXIST for id=' + localId);
      return;
    }
    const rtpCapabilities = data.rtpCapabilities;
    const remoteId = data.remoteId;
    scribbles.log('-- consumeAdd - localId=' + localId + ' remoteId=' + remoteId + ' kind=' + kind);
    const producer = getProducer(remoteId, kind);
    if (!producer) {
      scribbles.error('producer NOT EXIST for remoteId=%s kind=%s', remoteId, kind);
      return;
    }
    const { consumer, params } = await createConsumer(transport, producer, rtpCapabilities); // producer must exist before consume
    //subscribeConsumer = consumer;
    addConsumer(localId, remoteId, consumer, kind); // TODO: MUST comination of  local/remote id
    scribbles.log('addConsumer localId=%s, remoteId=%s, kind=%s', localId, remoteId, kind);
    consumer.observer.on('close', () => {
      scribbles.log('consumer closed ---');
    })
    consumer.on('producerclose', () => {
      scribbles.log('consumer -- on.producerclose');
      consumer.close();
      removeConsumer(localId, remoteId, kind);

      // -- notify to client ---
      socket.emit('producerClosed', { localId: localId, remoteId: remoteId, kind: kind });
    });

    scribbles.log('-- consumer ready ---');
    sendResponse(params, callback);
  });

  socket.on('resumeAdd', async (data, callback) => {
    const localId = getId(socket);
    const remoteId = data.remoteId;
    const kind = data.kind;
    scribbles.log('-- resumeAdd localId=%s remoteId=%s kind=%s', localId, remoteId, kind);
    let consumer = getConsumer(localId, remoteId, kind);
    if (!consumer) {
      scribbles.error('consumer NOT EXIST for remoteId=' + remoteId);
      return;
    }
    await consumer.resume();
    sendResponse({}, callback);
  });

  // ---- sendback welcome message with on connected ---
  const newId = getId(socket);
  sendback(socket, { type: 'welcome', id: newId });

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

function getId(socket) {
  return socket.id;
}

//function sendNotification(socket, message) {
//  socket.emit('notificatinon', message);
//}

function getClientCount() {
  // WARN: undocumented method to get clients number
  return io.eio.clientsCount;
}

function cleanUpPeer(socket) {
  const id = getId(socket);
  removeConsumerSetDeep(id);
  /*
  const consumer = getConsumer(id);
  if (consumer) {
    consumer.close();
    removeConsumer(id);
  }
  */

  const transport = getConsumerTrasnport(id);
  if (transport) {
    transport.close();
    removeConsumerTransport(id);
  }

  const videoProducer = getProducer(id, 'video');
  if (videoProducer) {
    videoProducer.close();
    removeProducer(id, 'video');
  }
  const audioProducer = getProducer(id, 'audio');
  if (audioProducer) {
    audioProducer.close();
    removeProducer(id, 'audio');
  }

  const producerTransport = getProducerTrasnport(id);
  if (producerTransport) {
    producerTransport.close();
    removeProducerTransport(id);
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
      { ip: '127.0.0.1', announcedIp: null }
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
//let producerTransport = null;
//let producer = null;
//let consumerTransport = null;
//let subscribeConsumer = null;


async function startWorker() {
  const mediaCodecs = mediasoupOptions.router.mediaCodecs;
  worker = await mediasoup.createWorker();
  router = await worker.createRouter({ mediaCodecs });
  //producerTransport = await router.createWebRtcTransport(mediasoupOptions.webRtcTransport);
  scribbles.log('-- mediasoup worker start. --')
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

// --- multi-producers --
let producerTransports = {};
let videoProducers = {};
let audioProducers = {};

function getProducerTrasnport(id) {
  return producerTransports[id];
}

function addProducerTrasport(id, transport) {
  producerTransports[id] = transport;
  scribbles.log('producerTransports count=' + Object.keys(producerTransports).length);
}

function removeProducerTransport(id) {
  delete producerTransports[id];
  scribbles.log('producerTransports count=' + Object.keys(producerTransports).length);
}

function getProducer(id, kind) {

  if (kind === 'video') {
    return videoProducers[id];
  }
  else if (kind === 'audio') {
    return audioProducers[id];
  }
  else {
    scribbles.warn('UNKNOWN producer kind=' + kind);
  }
}

/*
function getProducerIds(clientId) {
  let producerIds = [];
  for (const key in producers) {
    if (key !== clientId) {
      producerIds.push(key);
    }
  }
  return producerIds;
}
*/

function getRemoteIds(clientId, kind) {
  let remoteIds = [];
  if (kind === 'video') {
    for (const key in videoProducers) {
      if (key !== clientId) {
        remoteIds.push(key);
      }
    }
  }
  else if (kind === 'audio') {
    for (const key in audioProducers) {
      if (key !== clientId) {
        remoteIds.push(key);
      }
    }
  }
  return remoteIds;
}


function addProducer(id, producer, kind) {
  if (kind === 'video') {
    videoProducers[id] = producer;
    scribbles.log('videoProducers count=' + Object.keys(videoProducers).length);
  }
  else if (kind === 'audio') {
    audioProducers[id] = producer;
    scribbles.log('audioProducers count=' + Object.keys(audioProducers).length);
  }
  else {
    scribbles.warn('UNKNOWN producer kind=' + kind);
  }
}

function removeProducer(id, kind) {
  if (kind === 'video') {
    delete videoProducers[id];
    scribbles.log('videoProducers count=' + Object.keys(videoProducers).length);
  }
  else if (kind === 'audio') {
    delete audioProducers[id];
    scribbles.log('audioProducers count=' + Object.keys(audioProducers).length);
  }
  else {
    scribbles.warn('UNKNOWN producer kind=' + kind);
  }
}


// --- multi-consumers --
let consumerTransports = {};
let videoConsumers = {};
let audioConsumers = {};

function getConsumerTrasnport(id) {
  return consumerTransports[id];
}

function addConsumerTrasport(id, transport) {
  consumerTransports[id] = transport;
  scribbles.log('consumerTransports count=' + Object.keys(consumerTransports).length);
}

function removeConsumerTransport(id) {
  delete consumerTransports[id];
  scribbles.log('consumerTransports count=' + Object.keys(consumerTransports).length);
}

function getConsumerSet(localId, kind) {
  if (kind === 'video') {
    return videoConsumers[localId];
  }
  else if (kind === 'audio') {
    return audioConsumers[localId];
  }
  else {
    scribbles.warn('WARN: getConsumerSet() UNKNWON kind=%s', kind);
  }
}
function getConsumer(localId, remoteId, kind) {
  const set = getConsumerSet(localId, kind);
  if (set) {
    return set[remoteId];
  }
  else {
    return null;
  }
}

function addConsumer(localId, remoteId, consumer, kind) {
  const set = getConsumerSet(localId, kind);
  if (set) {
    set[remoteId] = consumer;
    scribbles.log('consumers kind=%s count=%d', kind, Object.keys(set).length);
  }
  else {
    scribbles.log('new set for kind=%s, localId=%s', kind, localId);
    const newSet = {};
    newSet[remoteId] = consumer;
    addConsumerSet(localId, newSet, kind);
    scribbles.log('consumers kind=%s count=%d', kind, Object.keys(newSet).length);
  }
}

function removeConsumer(localId, remoteId, kind) {
  const set = getConsumerSet(localId, kind);
  if (set) {
    delete set[remoteId];
    scribbles.log('consumers kind=%s count=%d', kind, Object.keys(set).length);
  }
  else {
    scribbles.log('NO set for kind=%s, localId=%s', kind, localId);
  }
}

function removeConsumerSetDeep(localId) {
  const set = getConsumerSet(localId, 'video');
  delete videoConsumers[localId];
  if (set) {
    for (const key in set) {
      const consumer = set[key];
      consumer.close();
      delete set[key];
    }

    scribbles.log('removeConsumerSetDeep video consumers count=' + Object.keys(set).length);
  }

  const audioSet = getConsumerSet(localId, 'audio');
  delete audioConsumers[localId];
  if (audioSet) {
    for (const key in audioSet) {
      const consumer = audioSet[key];
      consumer.close();
      delete audioSet[key];
    }

    scribbles.log('removeConsumerSetDeep audio consumers count=' + Object.keys(audioSet).length);
  }
}

function addConsumerSet(localId, set, kind) {
  if (kind === 'video') {
    videoConsumers[localId] = set;
  }
  else if (kind === 'audio') {
    audioConsumers[localId] = set;
  }
  else {
    scribbles.warn('WARN: addConsumerSet() UNKNWON kind=%s', kind);
  }
}

async function createTransport() {
  const transport = await router.createWebRtcTransport(mediasoupOptions.webRtcTransport);
  scribbles.log('-- create transport id=' + transport.id);

  return {
    transport: transport,
    params: {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    }
  };
}

async function createConsumer(transport, producer, rtpCapabilities) {
  let consumer = null;
  if (!router.canConsume(
    {
      producerId: producer.id,
      rtpCapabilities,
    })
  ) {
    scribbles.error('can not consume');
    return;
  }

  //consumer = await producerTransport.consume({ // NG: try use same trasport as producer (for loopback)
  consumer = await transport.consume({ // OK
    producerId: producer.id,
    rtpCapabilities,
    paused: producer.kind === 'video',
  }).catch(err => {
    scribbles.error('consume failed', err);
    return;
  });

  //if (consumer.type === 'simulcast') {
  //  await consumer.setPreferredLayers({ spatialLayer: 2, temporalLayer: 2 });
  //}

  return {
    consumer: consumer,
    params: {
      producerId: producer.id,
      id: consumer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      type: consumer.type,
      producerPaused: consumer.producerPaused
    }
  };
}

