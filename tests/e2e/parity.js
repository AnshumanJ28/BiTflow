const E = require('../../static/engine.js');
const P = require('../../static/presets.js');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const KINDS = Object.keys(E.SPECS);
let seed = 12345;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const pick = (a) => a[Math.floor(rnd() * a.length)];

function toClient(c) {
  return {
    nodes: c.nodes.map((n) => ({ ...n })),
    wires: c.wires.map((w) => ({ id: w.id, from: w.from, fromPin: w.from_pin, to: w.to, toPin: w.to_pin }))
  };
}

function randomCircuit() {
  const n = 2 + Math.floor(rnd() * 10);
  const nodes = [];
  for (let i = 0; i < n; i++) nodes.push({ id: 1 + i * 3 + Math.floor(rnd() * 3), kind: pick(KINDS), x: 0, y: 0, value: rnd() < 0.5, label: '' });
  const ids = new Set();
  const uniq = nodes.filter((x) => (ids.has(x.id) ? false : (ids.add(x.id), true)));
  const wires = [];
  const driven = new Set();
  let wid = 1;
  for (let k = 0; k < uniq.length * 2; k++) {
    const from = pick(uniq);
    const to = pick(uniq);
    if (E.SPECS[from.kind].outputs < 1 || E.SPECS[to.kind].inputs < 1) continue;
    const pin = Math.floor(rnd() * E.SPECS[to.kind].inputs);
    const key = to.id + ':' + pin;
    if (driven.has(key)) continue;
    driven.add(key);
    wires.push({ id: wid++, from: from.id, from_pin: 0, to: to.id, to_pin: pin });
  }
  return { nodes: uniq, wires };
}

async function check(label, circuit, previous) {
  const c = toClient(circuit);
  const prevMap = previous ? new Map(Object.entries(previous).map(([k, v]) => [Number(k), v])) : null;
  const js = E.evaluate(c.nodes, c.wires, prevMap);
  const res = await fetch(BASE + '/api/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ circuit, previous: previous || undefined })
  });
  const rs = await res.json();
  if (!res.ok) throw new Error(label + ': server error ' + JSON.stringify(rs));
  for (const nd of circuit.nodes) {
    if (rs.node_states[nd.id] !== js.levels.get(nd.id)) throw new Error(label + ': node ' + nd.id + ' differs');
  }
  for (const w of circuit.wires) {
    if (rs.wire_states[w.id] !== js.levels.get(w.from)) throw new Error(label + ': wire ' + w.id + ' differs');
  }
  if (rs.stable !== js.stable || rs.oscillating !== js.oscillating || rs.has_cycle !== js.hasCycle || rs.sweeps !== js.sweeps)
    throw new Error(label + ': flags differ ' + JSON.stringify([rs.stable, js.stable, rs.oscillating, js.oscillating, rs.has_cycle, js.hasCycle, rs.sweeps, js.sweeps]));
  return js;
}

(async () => {
  let checks = 0, osc = 0, cyc = 0;
  for (const [name, build] of Object.entries(P.PRESETS)) {
    const circuit = build();
    const js = await check(name, circuit);
    console.log(name.padEnd(16), 'stable=' + js.stable, 'cycle=' + js.hasCycle, 'sweeps=' + js.sweeps);
    checks++;
  }
  for (let i = 0; i < 1500; i++) {
    const circuit = randomCircuit();
    let previous = null;
    if (rnd() < 0.6) {
      previous = {};
      for (const nd of circuit.nodes) previous[nd.id] = rnd() < 0.5;
    }
    const js = await check('random#' + i, circuit, previous);
    if (js.oscillating) osc++;
    if (js.hasCycle) cyc++;
    checks++;
  }
  console.log('parity checks passed:', checks, '| with feedback:', cyc, '| oscillating:', osc);

  const latch = P.PRESETS['SR Latch']();
  const c = toClient(latch);
  const byLabel = (l) => latch.nodes.find((n) => n.label === l);
  let levels = null;
  const run = () => { const r = E.evaluate(c.nodes, c.wires, levels); levels = r.levels; return r; };
  const q = byLabel('Q').id, qn = byLabel('Qn').id;
  const setv = (l, v) => { c.nodes.find((n) => n.id === byLabel(l).id).value = v; };
  run();
  setv('S', true); run();
  console.log('latch after S=1   Q LED:', levels.get(q), 'Qn LED:', levels.get(qn));
  setv('S', false); run();
  console.log('latch after S=0   Q LED:', levels.get(q), 'Qn LED:', levels.get(qn), '(held)');
  setv('R', true); run();
  console.log('latch after R=1   Q LED:', levels.get(q), 'Qn LED:', levels.get(qn));
  setv('R', false); run();
  console.log('latch after R=0   Q LED:', levels.get(q), 'Qn LED:', levels.get(qn), '(held)');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
