import autocannon from 'autocannon';
import { findCapacity } from './search.js';
import { fork } from 'node:child_process';
import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import os from 'node:os';
const { values: args } = parseArgs({ options: {
  scenario: { type: 'string', default: 'simple' }, connections: { type: 'string' },
  'start-connections': { type: 'string', default: '10' }, 'max-connections': { type: 'string', default: '10000' },
  precision: { type: 'string', default: '5' }, refinements: { type: 'string', default: '12' },
  duration: { type: 'string', default: '10' }, warmup: { type: 'string', default: '3' },
  'max-p99': { type: 'string', default: '200' }, 'max-error-rate': { type: 'string', default: '1' },
  iterations: { type: 'string', default: '1000' }, 'delay-ms': { type: 'string', default: '20' },
  output: { type: 'string', default: 'results' }
} });
function numeric(value, name, min, max, integer = false) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw new Error('Valor inválido para ' + name);
  return n;
}
if (!['simple', 'cpu', 'io'].includes(args.scenario)) throw new Error('scenario: use simple, cpu ou io');
const ceiling = numeric(args['max-connections'], 'max-connections', 1, 100000, true);
const start = numeric(args['start-connections'], 'start-connections', 1, ceiling, true);
const precision = numeric(args.precision, 'precision', 1, 100000, true);
const refinements = numeric(args.refinements, 'refinements', 0, 30, true);
const levels = args.connections?.split(',').map(v => numeric(v, 'connections', 1, 100000, true)) ?? [];

if (levels.some((v, i) => i && v <= levels[i-1])) throw new Error('Conexões devem estar em ordem crescente');
const duration = numeric(args.duration, 'duration', 1, 3600, true);
const warmup = numeric(args.warmup, 'warmup', 0, 60, true);
const p99 = numeric(args['max-p99'], 'max-p99', 1, 60000);
const errors = numeric(args['max-error-rate'], 'max-error-rate', 0, 100);
const iterations = numeric(args.iterations, 'iterations', 1, 100000, true);
const delayMs = numeric(args['delay-ms'], 'delay-ms', 1, 1000, true);
const child = fork(new URL('./server.js', import.meta.url), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
let active;
let timer;
let samples = [];
child.on('message', msg => { if (msg.type === 'sample') samples.push(msg); });
const cancel = () => { active?.stop(); child.kill('SIGTERM'); };
for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { cancel(); process.exitCode = 130; });
const report = { startedAt: new Date().toISOString(), machine: { hostname: os.hostname(), platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), node: process.version }, config: args, stages: [] };
const run = (url, connections, seconds) => new Promise((resolve, reject) => { active = autocannon({ url, connections, duration: seconds, pipelining: 1, timeout: 5 }, (err, result) => { active = undefined; err ? reject(err) : resolve(result); }); });
function sample() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.off('message', listener); reject(new Error('API não respondeu à coleta de métricas')); }, 7000);
    const listener = msg => { if (msg.type === 'sample') { clearTimeout(timeout); child.off('message', listener); resolve(msg); } };
    child.on('message', listener); child.send('sample');
  });
}
try {
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { reject(new Error('Tempo limite ao iniciar API')); }, 10000);
    child.once('error', err => { clearTimeout(timeout); reject(err); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error('API encerrou: ' + code)); });
    child.on('message', msg => { if (msg.type === 'ready') { clearTimeout(timeout); resolve(msg.url); } });
  });
  const url = base + '/bench/' + args.scenario + (args.scenario === 'cpu' ? '?iterations=' + iterations : args.scenario === 'io' ? '?delayMs=' + delayMs : '');
  console.log('Benchmark local: ' + args.scenario);
  if (warmup) await run(url, levels[0] ?? start, warmup);
  const evaluate = async connections => {
    samples = []; child.send('reset');
    const before = await sample();
    timer = setInterval(() => { if (child.connected) child.send('sample'); }, 500);
    const raw = await run(url, connections, duration);
    clearInterval(timer);
    const after = await sample();
    const attempts = raw.requests.total + raw.errors;
    const errorRate = attempts ? 100 * (raw.errors + raw.non2xx) / attempts : 100;
    const cpuTime = after.cpu.user + after.cpu.system - before.cpu.user - before.cpu.system;
    const stage = { connections, requestsPerSecond: raw.requests.average, latencyP99Ms: raw.latency.p99,
      errorRatePercent: errorRate, errors: raw.errors, timeouts: raw.timeouts, non2xx: raw.non2xx,
      apiCpuPercentOfOneCore: 100 * cpuTime / ((after.at - before.at) * 1000),
      apiPeakSampledRssBytes: Math.max(...samples.map(s => s.memory.rss)), apiEventLoopP99Ms: after.lagP99Ms,
      passed: raw.requests.total > 0 && errorRate <= errors && raw.latency.p99 <= p99, raw };
    report.stages.push(stage);
    console.table([{ conexões: connections, 'req/s': stage.requestsPerSecond, 'p99 ms': stage.latencyP99Ms, 'erros %': errorRate.toFixed(2), 'CPU API %': stage.apiCpuPercentOfOneCore.toFixed(1), aprovado: stage.passed }]);
    return stage;
  };
  if (levels.length) {
    for (const connections of levels) {
      if (process.exitCode === 130 || !(await evaluate(connections)).passed) break;
    }
    report.mode = 'manual';
  } else {
    report.mode = 'adaptive';
    report.capacity = await findCapacity(evaluate, { start, ceiling, precision, refinements, cancelled: () => process.exitCode === 130 });
    const c = report.capacity;
    console.log(c.status === 'ceiling-reached'
      ? 'Teto aprovado: ' + c.maxPassingConnections + ' conexões. Limite não encontrado; aumente --max-connections.'
      : 'Maior etapa aprovada: ' + (c.maxPassingConnections ?? 'nenhuma') + '; menor reprovada: ' + c.minFailingConnections + '.');
  }
  report.finishedAt = new Date().toISOString();
  report.bestPassingStage = report.stages.filter(s => s.passed).sort((a,b) => b.requestsPerSecond-a.requestsPerSecond)[0] ?? null;
  await mkdir(args.output, { recursive: true });
  const file = resolve(args.output, 'benchmark-' + Date.now() + '.json');
  await writeFile(file, JSON.stringify(report, null, 2));
  console.log('Relatório: ' + file);
  if (process.exitCode !== 130 && (report.mode === 'manual' ? report.stages.some(s => !s.passed) : report.capacity.status === 'no-passing-stage')) process.exitCode = 2;
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  clearInterval(timer); active?.stop();
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
    await exited; clearTimeout(killTimer);
  }
}
