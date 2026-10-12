import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCapacity } from '../src/search.js';
const options = { start: 10, ceiling: 1000, precision: 1, refinements: 20 };
test('expande e refina a fronteira de aprovação', async () => {
  const visited = [];
  const result = await findCapacity(async n => { visited.push(n); return { passed: n <= 137 }; }, options);
  assert.equal(result.maxPassingConnections, 137);
  assert.equal(result.minFailingConnections, 138);
  assert.deepEqual(visited.slice(0, 5), [10, 20, 40, 80, 160]);
});
test('teto aprovado não é apresentado como limite', async () => {
  const result = await findCapacity(async () => ({ passed: true }), options);
  assert.equal(result.status, 'ceiling-reached');
  assert.equal(result.maxPassingConnections, 1000);
  assert.equal(result.minFailingConnections, null);
});
test('procura abaixo da primeira reprovação', async () => {
  const result = await findCapacity(async n => ({ passed: n <= 3 }), options);
  assert.equal(result.maxPassingConnections, 3);
  assert.equal(result.minFailingConnections, 4);
});
test('não inventa capacidade se todas as etapas falham', async () => {
  const result = await findCapacity(async () => ({ passed: false }), options);
  assert.equal(result.status, 'no-passing-stage');
  assert.equal(result.maxPassingConnections, null);
  assert.equal(result.minFailingConnections, 1);
});
test('limita o número de refinamentos', async () => {
  const result = await findCapacity(async n => ({ passed: n <= 137 }), { ...options, refinements: 0 });
  assert.equal(result.maxPassingConnections, 80);
  assert.equal(result.minFailingConnections, 160);
});
