(function (root) {
  'use strict';

  const SPECS = {
    INPUT_SWITCH: { inputs: 0, outputs: 1, source: true, sink: false },
    CLOCK: { inputs: 0, outputs: 1, source: true, sink: false },
    AND: { inputs: 2, outputs: 1, source: false, sink: false },
    OR: { inputs: 2, outputs: 1, source: false, sink: false },
    NOT: { inputs: 1, outputs: 1, source: false, sink: false },
    NAND: { inputs: 2, outputs: 1, source: false, sink: false },
    NOR: { inputs: 2, outputs: 1, source: false, sink: false },
    XOR: { inputs: 2, outputs: 1, source: false, sink: false },
    XNOR: { inputs: 2, outputs: 1, source: false, sink: false },
    OUTPUT_LED: { inputs: 1, outputs: 0, source: false, sink: true },
    PROBE: { inputs: 1, outputs: 0, source: false, sink: true }
  };

  const MAX_SWEEPS = 100;

  function evalGate(kind, a, b) {
    switch (kind) {
      case 'AND': return a && b;
      case 'OR': return a || b;
      case 'NOT': return !a;
      case 'NAND': return !(a && b);
      case 'NOR': return !(a || b);
      case 'XOR': return a !== b;
      case 'XNOR': return a === b;
      case 'OUTPUT_LED':
      case 'PROBE': return a;
      default: return false;
    }
  }

  function evaluate(nodes, wires, previous) {
    const sorted = nodes.slice().sort((x, y) => x.id - y.id);
    const n = sorted.length;
    const pos = new Map();
    sorted.forEach((node, i) => pos.set(node.id, i));

    const drivers = sorted.map((node) => new Array(SPECS[node.kind].inputs).fill(-1));
    const indegree = new Array(n).fill(0);
    const adjacency = sorted.map(() => []);

    for (const wire of wires) {
      const from = pos.get(wire.from);
      const to = pos.get(wire.to);
      if (from === undefined || to === undefined) continue;
      if (wire.toPin < 0 || wire.toPin >= drivers[to].length) continue;
      drivers[to][wire.toPin] = from;
      indegree[to] += 1;
      adjacency[from].push(to);
    }

    const queue = [];
    for (let i = 0; i < n; i++) if (indegree[i] === 0) queue.push(i);
    const order = [];
    const placed = new Array(n).fill(false);
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head];
      placed[i] = true;
      order.push(i);
      for (const t of adjacency[i]) {
        indegree[t] -= 1;
        if (indegree[t] === 0) queue.push(t);
      }
    }
    const hasCycle = order.length < n;
    for (let i = 0; i < n; i++) if (!placed[i]) order.push(i);

    const levels = sorted.map((node) => (previous ? previous.get(node.id) === true : false));
    const seen = new Set();
    let sweeps = 0;
    let stable = false;
    let oscillating = false;

    for (;;) {
      sweeps += 1;
      let changed = false;
      for (const p of order) {
        const node = sorted[p];
        const spec = SPECS[node.kind];
        let next;
        if (spec.source) {
          next = node.value === true;
        } else {
          const d = drivers[p];
          const a = d.length > 0 && d[0] >= 0 ? levels[d[0]] : false;
          const b = d.length > 1 && d[1] >= 0 ? levels[d[1]] : false;
          next = evalGate(node.kind, a, b);
        }
        if (next !== levels[p]) {
          levels[p] = next;
          changed = true;
        }
      }
      if (!changed) {
        stable = true;
        break;
      }
      const key = levels.map((v) => (v ? '1' : '0')).join('');
      if (seen.has(key) || sweeps >= MAX_SWEEPS) {
        oscillating = true;
        break;
      }
      seen.add(key);
    }

    const result = new Map();
    sorted.forEach((node, i) => result.set(node.id, levels[i]));
    return { levels: result, stable, oscillating, hasCycle, sweeps };
  }

  const api = { SPECS, MAX_SWEEPS, evaluate, coreOrigin: 'anshumanj28' };
  root.LogicEngine = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
