// Holds one public MC live connection open like the browser does (15s keepalive)
// and asks a text turn at fixed minute marks, logging any drop with its close code.
// Usage: node scripts/soak-staging-mc.mjs [minutes=35]
import { createRequire } from 'node:module';
import { MC_SYSTEM_PROMPT } from '../client/src/lib/mcSession.js';
const require = createRequire(new URL('../live-gateway/package.json', import.meta.url));
const WebSocket = require('ws');
const origin = 'https://d32nzk2gacfhag.cloudfront.net';
const minutes = Number(process.argv[2]) || 35;
const turnsAt = [1, 3, 8, 15, 25, 34, 45, 58, 65].filter((m) => m < minutes);
const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 60000).toFixed(2)}m`;
const socket = new WebSocket(`${origin.replace('https:', 'wss:')}/api/live/chat/realtime?language=en`, { origin });
let pending = null;
socket.on('open', () => { console.log(stamp(), 'open'); socket.send(JSON.stringify({ type: 'session.init', systemPrompt: MC_SYSTEM_PROMPT })); });
socket.on('message', (data) => {
  const event = JSON.parse(data.toString());
  if (event.type === 'session.ready') console.log(stamp(), 'session.ready');
  if (event.type === 'assistant.text.done' && pending) { console.log(stamp(), `turn@${pending.m} ok ${Date.now() - pending.at}ms:`, event.text.slice(0, 70)); pending = null; }
  if (['error', 'session.auth.failed', 'session.closed', 'session.error'].includes(event.type)) console.log(stamp(), 'EVENT', JSON.stringify(event).slice(0, 300));
});
socket.on('close', (code, reason) => { console.log(stamp(), 'CLOSE', code, reason.toString()); process.exit(Date.now() - t0 >= minutes * 60000 - 5000 ? 0 : 1); });
socket.on('error', (error) => console.log(stamp(), 'ERROR', error.message));
setInterval(() => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: 'keepalive' })), 15000);
for (const m of turnsAt) setTimeout(() => {
  if (pending) console.log(stamp(), `turn@${pending.m} NO REPLY`);
  pending = { m, at: Date.now() };
  socket.send(JSON.stringify({ type: 'user.text', text: `Quick check at minute ${m}: give the audience a one-line update.` }));
}, m * 60000);
setTimeout(() => { if (pending) console.log(stamp(), `turn@${pending.m} NO REPLY`); console.log(stamp(), 'PASS: connection held'); socket.close(); }, minutes * 60000);
