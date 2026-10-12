// A capacidade é estimada pelos critérios de aprovação, não por sockets abertos.
export async function findCapacity(evaluate, { start, ceiling, precision, refinements, cancelled = () => false }) {
  let lower = 0;
  let upper = null;
  let current = start;
  while (!cancelled()) {
    const stage = await evaluate(current);
    if (!stage.passed) { upper = current; break; }
    lower = current;
    if (current === ceiling) return { status: 'ceiling-reached', maxPassingConnections: lower, minFailingConnections: null };
    current = Math.min(ceiling, current * 2);
  }
  let steps = 0;
  while (!cancelled() && upper !== null && upper - lower > precision && steps < refinements) {
    const mid = Math.floor((lower + upper) / 2);
    const stage = await evaluate(mid);
    if (stage.passed) lower = mid;
    else upper = mid;
    steps++;
  }
  return { status: cancelled() ? 'interrupted' : lower === 0 ? 'no-passing-stage' : 'estimated',
    maxPassingConnections: lower || null, minFailingConnections: upper,
    uncertaintyConnections: upper === null ? null : upper - lower, refinementSteps: steps };
}
