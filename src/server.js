import Fastify from 'fastify';
import { pbkdf2Sync } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { monitorEventLoopDelay } from 'node:perf_hooks';
const app = Fastify({ logger: false });
const lag = monitorEventLoopDelay({ resolution: 20 });
lag.enable();
const schema = (key, max, value) => ({ querystring: { type: 'object', additionalProperties: false, properties: { [key]: { type: 'integer', minimum: 1, maximum: max, default: value } } } });
app.get('/bench/simple', async () => ({ hello: 'world' }));
app.get('/bench/io', { schema: schema('delayMs', 1000, 20) }, async req => { await setTimeout(req.query.delayMs); return { ok: true }; });
app.get('/bench/cpu', { schema: schema('iterations', 100000, 1000) }, async req => ({ hash: pbkdf2Sync('bench', 'salt', req.query.iterations, 32, 'sha256').toString('hex') }));
process.on('message', message => {
  if (message === 'reset') { lag.reset(); return; }
  if (message === 'sample') process.send?.({ type: 'sample', at: Date.now(), cpu: process.cpuUsage(), memory: process.memoryUsage(), lagP99Ms: lag.percentile(99) / 1e6 });
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { lag.disable(); await app.close(); process.exit(0); });
try { const url = await app.listen({ host: '127.0.0.1', port: 0 }); process.send?.({ type: 'ready', url }); }
catch (error) { console.error(error); process.exit(1); }
