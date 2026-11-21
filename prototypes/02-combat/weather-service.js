// AMANN ASSAULT — the weather service as its own program (its own CPU core).
// Needs a NATS server and the game server started with the same BUS:
//   BUS=nats://localhost:4222 WEATHER=external node server.js
//   BUS=nats://localhost:4222 node weather-service.js
// (Windows PowerShell: $env:BUS="nats://localhost:4222"; node weather-service.js)
'use strict';
const { connectBus } = require('../shared/bus-nats.js');
const { startWeatherService } = require('./server.js');

(async () => {
  const url = process.env.BUS || 'nats://localhost:4222';
  const bus = await connectBus(url);
  startWeatherService(bus);
  console.log('Weather service running on NATS at ' + url + '. It picks up the current sky from the game server.');
})().catch(e => { console.error(e.message || e); process.exit(1); });
