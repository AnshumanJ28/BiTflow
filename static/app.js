(function () {
  'use strict';

  const E = window.LogicEngine;
  const P = window.LogicPresets;
  const GRID = 20;
  const MIN_SCALE = 0.25;
  const MAX_SCALE = 3;
  const PIN_RADIUS = 11;

  const DIM = {
    INPUT_SWITCH: { name: 'Switch', w: 60, h: 40 },
    CLOCK: { name: 'Clock', w: 70, h: 40 },
    AND: { name: 'AND', w: 80, h: 60 },
    OR: { name: 'OR', w: 80, h: 60 },
    NOT: { name: 'NOT', w: 70, h: 40 },
    NAND: { name: 'NAND', w: 80, h: 60 },
    NOR: { name: 'NOR', w: 80, h: 60 },
    XOR: { name: 'XOR', w: 80, h: 60 },
    XNOR: { name: 'XNOR', w: 80, h: 60 },
    OUTPUT_LED: { name: 'LED', w: 50, h: 40 },
    PROBE: { name: 'Probe', w: 60, h: 40 }
  };

  const GROUPS = [
    ['Inputs', ['INPUT_SWITCH', 'CLOCK']],
    ['Gates', ['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR']],
    ['Outputs', ['OUTPUT_LED', 'PROBE']]
  ];

  const COLORS = {
    high: '#39ff88',
    glow: 'rgba(57, 255, 136, 0.85)',
    lowWire: '#1e382b',
    lowStroke: '#475569',
    posHigh: '#38bdf8',
    posGlow: 'rgba(56, 189, 248, 0.85)',
    posLow: '#25445c',
    posBody: '#0b1f2e',
    negHigh: '#ff3366',
    negGlow: 'rgba(255, 51, 102, 0.85)',
    negLow: '#542631',
    negBody: '#2b0d15',
    body: '#101923',
    bodyOn: '#0f2a22',
    text: '#cfd9e6',
    muted: '#7d8da1',
    select: '#22e5ff',
    danger: '#ff5c7a',
    dot: 'rgba(125, 141, 161, 0.28)'
  };

  function isNegGate(kind) {
    return kind === 'NOT' || kind === 'NAND' || kind === 'NOR' || kind === 'XNOR';
  }

  function isPosGate(kind) {
    return kind === 'AND' || kind === 'OR' || kind === 'XOR';
  }

  function gateColorsFor(kind, on) {
    if (isNegGate(kind)) {
      return {
        stroke: on ? COLORS.negHigh : COLORS.negLow,
        glow: COLORS.negGlow,
        body: on ? COLORS.negBody : COLORS.body,
        on
      };
    }
    if (isPosGate(kind)) {
      return {
        stroke: on ? COLORS.posHigh : COLORS.posLow,
        glow: COLORS.posGlow,
        body: on ? COLORS.posBody : COLORS.body,
        on
      };
    }
    return {
      stroke: on ? COLORS.high : COLORS.lowStroke,
      glow: COLORS.glow,
      body: on ? COLORS.bodyOn : COLORS.body,
      on
    };
  }

  const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const stage = document.getElementById('stage');
  const tip = document.getElementById('tip');
  const statusMsg = document.getElementById('status-msg');
  const statusInfo = document.getElementById('status-info');
  const runButton = document.getElementById('btn-run');
  const speedInput = document.getElementById('speed');
  const speedLabel = document.getElementById('speed-label');
  const presetSelect = document.getElementById('presets');
  const fileInput = document.getElementById('file');
  const dialog = document.getElementById('table-dialog');
  const tableBody = document.getElementById('table-body');
  const contextMenu = document.getElementById('context-menu');
  const ctxTitle = document.getElementById('ctx-title');
  const ctxDelete = document.getElementById('ctx-delete');
  const ctxRename = document.getElementById('ctx-rename');
  let activeContextNode = null;

  const state = {
    nodes: [],
    wires: [],
    map: new Map(),
    coreOrigin: 'anshumanj28',
    nextNode: 1,
    nextWire: 1,
    view: { x: 60, y: 60, scale: 1 },
    sel: { nodes: new Set(), wire: null },
    levels: new Map(),
    prevLevels: new Map(),
    sim: { stable: true, oscillating: false, hasCycle: false, sweeps: 0 },
    running: true,
    hz: 2,
    clockAcc: 0,
    rev: 0,
    drag: null,
    hover: null,
    spawn: 0,
    backend: 'checking',
    size: { w: 0, h: 0, dpr: 1 }
  };

  let flashTimer = null;
  let validateTimer = null;
  let validating = false;

  function snap(v) {
    return Math.round(v / GRID) * GRID;
  }

  function screenToWorld(sx, sy) {
    return { x: (sx - state.view.x) / state.view.scale, y: (sy - state.view.y) / state.view.scale };
  }

  function pointerScreen(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function nodeById(id) {
    return state.map.get(id);
  }

  function pinPos(node, isOutput, idx) {
    const d = DIM[node.kind];
    if (isOutput) return { x: node.x + d.w, y: node.y + d.h / 2 };
    const count = E.SPECS[node.kind].inputs;
    const y = count === 1 ? d.h / 2 : idx === 0 ? 20 : 40;
    return { x: node.x, y: node.y + y };
  }

  function pinsOf(node) {
    const spec = E.SPECS[node.kind];
    const list = [];
    for (let i = 0; i < spec.inputs; i++) {
      const p = pinPos(node, false, i);
      list.push({ node, isOutput: false, idx: i, x: p.x, y: p.y });
    }
    for (let i = 0; i < spec.outputs; i++) {
      const p = pinPos(node, true, i);
      list.push({ node, isOutput: true, idx: i, x: p.x, y: p.y });
    }
    return list;
  }

  function wireInto(nodeId, pin) {
    return state.wires.find((w) => w.to === nodeId && w.toPin === pin);
  }

  function level(id) {
    return state.levels.get(id) === true;
  }

  function inputLevel(node, pin) {
    const w = wireInto(node.id, pin);
    return w ? level(w.from) : false;
  }

  function flash(message, kind) {
    statusMsg.textContent = message;
    statusMsg.className = kind || '';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      statusMsg.textContent = 'Ready';
      statusMsg.className = '';
    }, 4000);
  }

  function updateInfo() {
    const parts = [];
    parts.push(state.nodes.length + ' nodes');
    parts.push(state.wires.length + ' wires');
    let simText;
    let simClass = 'ok';
    let extra = '';
    if (state.sim.oscillating) {
      extra = ' | <span class="bad">oscillating</span>';
    } else if (!state.sim.stable) {
      extra = ' | <span class="warn">unsettled</span>';
    }
    statusInfo.innerHTML = parts.join(' | ') + extra + ' | ' + Math.round(state.view.scale * 100) + '%';
  }

  function evaluate() {
    state.prevLevels = state.levels;
    const result = E.evaluate(state.nodes, state.wires, state.levels);
    state.levels = result.levels;
    state.sim = result;
    state.rev += 1;
    updateInfo();
    scheduleValidate();
  }

  function serialize() {
    return {
      version: 1,
      author: 'anshumanj28',
      nodes: state.nodes.map((n) => ({
        id: n.id,
        kind: n.kind,
        x: n.x,
        y: n.y,
        value: n.value === true,
        label: n.label || ''
      })),
      wires: state.wires.map((w) => ({
        id: w.id,
        from: w.from,
        from_pin: w.fromPin,
        to: w.to,
        to_pin: w.toPin
      }))
    };
  }

  function scheduleValidate() {
    if (validateTimer !== null) return;
    validateTimer = setTimeout(() => {
      validateTimer = null;
      validateWithBackend();
    }, 160);
  }

  async function validateWithBackend() {
    if (validating) {
      scheduleValidate();
      return;
    }
    validating = true;
    const sentRev = state.rev;
    const previous = {};
    state.prevLevels.forEach((v, id) => {
      previous[id] = v;
    });
    try {
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ circuit: serialize(), previous })
      });
      const data = await res.json();
      if (!res.ok) {
        state.backend = 'rejected';
        flash('Backend rejected circuit: ' + (data.error || res.status), 'bad');
      } else if (sentRev === state.rev) {
        let mismatch = false;
        for (const node of state.nodes) {
          if (data.node_states[node.id] !== level(node.id)) {
            mismatch = true;
            break;
          }
        }
        if (mismatch) {
          const synced = new Map();
          for (const node of state.nodes) synced.set(node.id, data.node_states[node.id] === true);
          state.levels = synced;
          state.backend = 'verified (resynced)';
          flash('Client and backend disagreed; adopted the backend result', 'warn');
        } else {
          state.backend = 'verified';
        }
      }
    } catch (error) {
      state.backend = 'offline';
    }
    validating = false;
    updateInfo();
  }

  function labelFor(kind) {
    const used = new Set(state.nodes.map((n) => n.label));
    if (kind === 'INPUT_SWITCH') {
      for (let i = 0; i < 26; i++) {
        const c = String.fromCharCode(65 + i);
        if (!used.has(c)) return c;
      }
      return '';
    }
    const base = kind === 'CLOCK' ? 'CLK' : kind === 'OUTPUT_LED' ? 'Y' : kind === 'PROBE' ? 'P' : null;
    if (!base) return '';
    if (!used.has(base)) return base;
    for (let i = 2; i < 200; i++) if (!used.has(base + i)) return base + i;
    return '';
  }

  function addNode(kind, x, y, label, value) {
    const node = {
      id: state.nextNode++,
      kind,
      x: snap(x),
      y: snap(y),
      value: value === true,
      label: label !== undefined ? label : labelFor(kind)
    };
    state.nodes.push(node);
    state.map.set(node.id, node);
    return node;
  }

  function removeNode(id) {
    state.nodes = state.nodes.filter((n) => n.id !== id);
    state.map.delete(id);
    state.wires = state.wires.filter((w) => w.from !== id && w.to !== id);
  }

  function removeWire(id) {
    state.wires = state.wires.filter((w) => w.id !== id);
  }

  function connect(fromNode, fromPin, toNode, toPin) {
    const existing = wireInto(toNode.id, toPin);
    if (existing) removeWire(existing.id);
    state.wires.push({
      id: state.nextWire++,
      from: fromNode.id,
      fromPin,
      to: toNode.id,
      toPin
    });
  }

  function clearSelection() {
    state.sel.nodes.clear();
    state.sel.wire = null;
  }

  function loadCircuit(data) {
    if (!data || !Array.isArray(data.nodes)) throw new Error('Not a circuit file');
    const nodes = [];
    const ids = new Set();
    for (const raw of data.nodes) {
      if (!raw || !DIM[raw.kind] || !Number.isInteger(raw.id) || raw.id < 0 || ids.has(raw.id)) continue;
      ids.add(raw.id);
      nodes.push({
        id: raw.id,
        kind: raw.kind,
        x: Number.isFinite(raw.x) ? raw.x : 0,
        y: Number.isFinite(raw.y) ? raw.y : 0,
        value: raw.value === true,
        label: typeof raw.label === 'string' ? raw.label.slice(0, 16) : ''
      });
    }
    const map = new Map(nodes.map((n) => [n.id, n]));
    const wires = [];
    const driven = new Set();
    let wireId = 1;
    for (const raw of Array.isArray(data.wires) ? data.wires : []) {
      if (!raw) continue;
      const from = map.get(raw.from);
      const to = map.get(raw.to);
      const fromPin = raw.from_pin !== undefined ? raw.from_pin : raw.fromPin !== undefined ? raw.fromPin : 0;
      const toPin = raw.to_pin !== undefined ? raw.to_pin : raw.toPin;
      if (!from || !to) continue;
      if (fromPin !== 0 || E.SPECS[from.kind].outputs < 1) continue;
      if (!Number.isInteger(toPin) || toPin < 0 || toPin >= E.SPECS[to.kind].inputs) continue;
      const key = to.id + ':' + toPin;
      if (driven.has(key)) continue;
      driven.add(key);
      wires.push({ id: wireId++, from: from.id, fromPin: 0, to: to.id, toPin });
    }
    state.nodes = nodes;
    state.map = map;
    state.wires = wires;
    state.nextNode = nodes.reduce((m, n) => Math.max(m, n.id), 0) + 1;
    state.nextWire = wireId;
    state.levels = new Map();
    state.prevLevels = new Map();
    clearSelection();
    state.drag = null;
    evaluate();
    fitView();
  }

  function fitView() {
    if (state.nodes.length === 0) {
      state.view = { x: 60, y: 60, scale: 1 };
      updateInfo();
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of state.nodes) {
      const d = DIM[n.kind];
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + d.w);
      maxY = Math.max(maxY, n.y + d.h);
    }
    const pad = 70;
    const w = state.size.w;
    const h = state.size.h;
    const scale = Math.max(MIN_SCALE, Math.min(1.4, (w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxY - minY)));
    state.view.scale = scale;
    state.view.x = (w - (maxX - minX) * scale) / 2 - minX * scale;
    state.view.y = (h - (maxY - minY) * scale) / 2 - minY * scale;
    updateInfo();
  }

  function hitPin(p, outputFilter) {
    const radius = PIN_RADIUS / state.view.scale;
    for (let i = state.nodes.length - 1; i >= 0; i--) {
      for (const pin of pinsOf(state.nodes[i])) {
        if (outputFilter !== undefined && pin.isOutput !== outputFilter) continue;
        if (Math.hypot(pin.x - p.x, pin.y - p.y) <= radius) return pin;
      }
    }
    return null;
  }

  function hitNode(p) {
    for (let i = state.nodes.length - 1; i >= 0; i--) {
      const n = state.nodes[i];
      const d = DIM[n.kind];
      if (p.x >= n.x && p.x <= n.x + d.w && p.y >= n.y && p.y <= n.y + d.h) return n;
    }
    return null;
  }

  function wireGeometry(w) {
    const a = nodeById(w.from);
    const b = nodeById(w.to);
    if (!a || !b) return null;
    const p0 = pinPos(a, true, w.fromPin);
    const p1 = pinPos(b, false, w.toPin);
    return bezier(p0, p1);
  }

  function bezier(p0, p1) {
    const dx = Math.max(50, Math.abs(p1.x - p0.x) * 0.5);
    return { p0, c1: { x: p0.x + dx, y: p0.y }, c2: { x: p1.x - dx, y: p1.y }, p1 };
  }

  function bezierPoint(g, t) {
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    return {
      x: a * g.p0.x + b * g.c1.x + c * g.c2.x + d * g.p1.x,
      y: a * g.p0.y + b * g.c1.y + c * g.c2.y + d * g.p1.y
    };
  }

  function hitWire(p) {
    const tolerance = 7 / state.view.scale;
    for (let i = state.wires.length - 1; i >= 0; i--) {
      const g = wireGeometry(state.wires[i]);
      if (!g) continue;
      let prev = g.p0;
      for (let s = 1; s <= 28; s++) {
        const cur = bezierPoint(g, s / 28);
        if (distToSegment(p, prev, cur) <= tolerance) return state.wires[i];
        prev = cur;
      }
    }
    return null;
  }

  function distToSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  function rrect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function strokeStyleFor(c, on) {
    c.strokeStyle = on ? COLORS.high : COLORS.lowStroke;
    c.lineWidth = 2;
    c.shadowColor = COLORS.glow;
    c.shadowBlur = on ? 12 : 0;
  }

  function clearShadow(c) {
    c.shadowBlur = 0;
    c.shadowColor = 'transparent';
  }

  function gateBody(c, kind, w, h, bw) {
    c.beginPath();
    if (kind === 'AND' || kind === 'NAND') {
      c.moveTo(0, 0);
      c.lineTo(bw * 0.5, 0);
      c.bezierCurveTo(bw * 0.85, 0, bw, h * 0.25, bw, h / 2);
      c.bezierCurveTo(bw, h * 0.75, bw * 0.85, h, bw * 0.5, h);
      c.lineTo(0, h);
      c.closePath();
    } else if (kind === 'NOT') {
      c.moveTo(0, 0);
      c.lineTo(bw, h / 2);
      c.lineTo(0, h);
      c.closePath();
    } else {
      const x0 = kind === 'XOR' || kind === 'XNOR' ? 8 : 0;
      const span = bw - x0;
      c.moveTo(x0, 0);
      c.bezierCurveTo(x0 + span * 0.45, 0, x0 + span * 0.8, h * 0.15, bw, h / 2);
      c.bezierCurveTo(x0 + span * 0.8, h * 0.85, x0 + span * 0.45, h, x0, h);
      c.quadraticCurveTo(x0 + span * 0.3, h / 2, x0, 0);
      c.closePath();
    }
  }

  function drawGate(c, kind, w, h, on) {
    const inverted = isNegGate(kind);
    const bw = inverted ? w - 10 : w;
    const inputs = E.SPECS[kind].inputs;
    const gc = gateColorsFor(kind, on);

    c.strokeStyle = gc.stroke;
    c.lineWidth = 2;
    c.shadowBlur = 0;
    c.beginPath();
    if (inputs === 1) {
      c.moveTo(0, h / 2);
      c.lineTo(10, h / 2);
    } else {
      c.moveTo(0, 20);
      c.lineTo(14, 20);
      c.moveTo(0, 40);
      c.lineTo(14, 40);
    }
    c.moveTo(inverted ? bw + 10 : bw, h / 2);
    c.lineTo(w, h / 2);
    c.stroke();

    gateBody(c, kind, w, h, bw);
    c.fillStyle = gc.body;
    c.fill();
    c.strokeStyle = gc.stroke;
    c.lineWidth = 2;
    c.shadowColor = gc.glow;
    c.shadowBlur = on ? 12 : 0;
    c.stroke();
    clearShadow(c);

    if (kind === 'XOR' || kind === 'XNOR') {
      const span = bw - 8;
      c.beginPath();
      c.moveTo(0, 0);
      c.quadraticCurveTo(span * 0.3, h / 2, 0, h);
      c.strokeStyle = gc.stroke;
      c.lineWidth = 2;
      c.stroke();
    }

    if (inverted) {
      c.beginPath();
      c.arc(bw + 5, h / 2, 4.5, 0, Math.PI * 2);
      c.fillStyle = on ? gc.stroke : gc.body;
      c.fill();
      c.strokeStyle = gc.stroke;
      c.lineWidth = 2;
      if (on) {
        c.shadowColor = gc.glow;
        c.shadowBlur = 8;
      }
      c.stroke();
      clearShadow(c);
    }
  }

  function drawBody(c, node, on, time) {
    const kind = node.kind;
    const d = DIM[kind];
    const w = d.w;
    const h = d.h;

    const spec = E.SPECS[kind];
    if (!spec.source && !spec.sink) {
      drawGate(c, kind, w, h, on);
      return;
    }

    if (kind === 'INPUT_SWITCH') {
      rrect(c, 0, 0, w, h, 8);
      c.fillStyle = on ? COLORS.bodyOn : COLORS.body;
      c.fill();
      strokeStyleFor(c, on);
      c.stroke();
      clearShadow(c);
      rrect(c, 8, 12, 30, 16, 8);
      c.fillStyle = on ? 'rgba(57, 255, 136, 0.25)' : '#1a2431';
      c.fill();
      c.beginPath();
      c.arc(on ? 30 : 16, 20, 6, 0, Math.PI * 2);
      c.fillStyle = on ? COLORS.high : '#6b7a8f';
      c.shadowColor = COLORS.glow;
      c.shadowBlur = on ? 10 : 0;
      c.fill();
      clearShadow(c);
      c.fillStyle = on ? COLORS.high : COLORS.muted;
      c.font = 'bold 14px ' + MONO;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(on ? '1' : '0', 49, 21);
      return;
    }

    if (kind === 'CLOCK') {
      rrect(c, 0, 0, w, h, 8);
      c.fillStyle = on ? COLORS.bodyOn : COLORS.body;
      c.fill();
      strokeStyleFor(c, on);
      c.stroke();
      clearShadow(c);
      c.fillStyle = COLORS.muted;
      c.font = '9px ' + MONO;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('CLK ' + state.hz + 'Hz', w / 2, 10);
      c.beginPath();
      const hi = 21;
      const lo = 32;
      c.moveTo(10, lo);
      c.lineTo(10, hi);
      c.lineTo(24, hi);
      c.lineTo(24, lo);
      c.lineTo(38, lo);
      c.lineTo(38, hi);
      c.lineTo(52, hi);
      c.lineTo(52, lo);
      c.lineTo(60, lo);
      c.strokeStyle = on ? COLORS.high : COLORS.lowStroke;
      c.lineWidth = 1.5;
      c.stroke();
      return;
    }

    if (kind === 'OUTPUT_LED') {
      c.beginPath();
      c.moveTo(0, h / 2);
      c.lineTo(17, h / 2);
      strokeStyleFor(c, on);
      c.shadowBlur = 0;
      c.stroke();
      c.beginPath();
      c.arc(30, h / 2, 13, 0, Math.PI * 2);
      if (on) {
        c.shadowColor = COLORS.glow;
        c.shadowBlur = 14;
        c.fillStyle = COLORS.high;
      } else {
        c.fillStyle = '#131c27';
      }
      c.fill();
      clearShadow(c);
      c.lineWidth = 2;
      c.strokeStyle = on ? '#b6ffd3' : COLORS.lowStroke;
      c.stroke();
      return;
    }

    if (kind === 'PROBE') {
      rrect(c, 0, 0, w, h, 8);
      c.fillStyle = on ? COLORS.bodyOn : COLORS.body;
      c.fill();
      strokeStyleFor(c, on);
      c.stroke();
      clearShadow(c);
      c.fillStyle = on ? COLORS.high : COLORS.muted;
      c.font = 'bold 18px ' + MONO;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(on ? '1' : '0', w / 2 + 4, h / 2 + 1);
    }
  }

  function nodeOn(node) {
    return level(node.id);
  }

  function drawNode(c, node, time, selected) {
    const d = DIM[node.kind];
    c.save();
    c.translate(node.x, node.y);
    drawBody(c, node, nodeOn(node), time);

    if (selected) {
      c.setLineDash([5, 4]);
      c.strokeStyle = COLORS.select;
      c.lineWidth = 1.5;
      c.strokeRect(-8, -8, d.w + 16, d.h + 16);
      c.setLineDash([]);
    }

    if (node.label) {
      c.fillStyle = COLORS.text;
      c.font = '11px ' + MONO;
      c.textAlign = 'center';
      c.textBaseline = 'alphabetic';
      c.fillText(node.label, d.w / 2, d.h + 18);
    }
    c.restore();

    for (const pin of pinsOf(node)) {
      const on = pin.isOutput ? level(node.id) : inputLevel(node, pin.idx);
      const connected = pin.isOutput
        ? state.wires.some((w) => w.from === node.id)
        : wireInto(node.id, pin.idx) !== undefined;
      const pinColor = on
        ? (isNegGate(node.kind) && pin.isOutput ? COLORS.negHigh : isPosGate(node.kind) && pin.isOutput ? COLORS.posHigh : COLORS.high)
        : (connected ? '#1e382b' : '#0b1118');
      c.beginPath();
      c.arc(pin.x, pin.y, 4, 0, Math.PI * 2);
      c.fillStyle = pinColor;
      c.fill();
      c.lineWidth = 1.5;
      c.strokeStyle = on ? pinColor : COLORS.lowStroke;
      c.stroke();
    }
  }

  function traceCurve(c, g) {
    c.beginPath();
    c.moveTo(g.p0.x, g.p0.y);
    c.bezierCurveTo(g.c1.x, g.c1.y, g.c2.x, g.c2.y, g.p1.x, g.p1.y);
  }

  function drawWire(c, w, time) {
    const g = wireGeometry(w);
    if (!g) return;
    const on = level(w.from);
    const selected = state.sel.wire === w.id;

    if (selected) {
      traceCurve(c, g);
      c.strokeStyle = COLORS.select;
      c.lineWidth = 7;
      c.globalAlpha = 0.35;
      c.stroke();
      c.globalAlpha = 1;
    }

    traceCurve(c, g);
    c.lineCap = 'round';
    c.lineWidth = on ? 3 : 2.5;
    c.strokeStyle = on ? COLORS.high : COLORS.lowWire;
    if (on) {
      c.shadowColor = COLORS.glow;
      c.shadowBlur = 8;
    }
    c.stroke();
    clearShadow(c);
  }

  function drawGrid(c, w, h) {
    const base = GRID * state.view.scale;
    const step = state.view.scale < 0.6 ? base * 2 : base;
    const ox = ((state.view.x % step) + step) % step;
    const oy = ((state.view.y % step) + step) % step;
    c.fillStyle = COLORS.dot;
    const size = state.view.scale < 0.6 ? 1.5 : 2;
    for (let x = ox; x < w; x += step) {
      for (let y = oy; y < h; y += step) {
        c.fillRect(x - size / 2, y - size / 2, size, size);
      }
    }
  }

  function draw(time) {
    const { w, h, dpr } = state.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#090e14';
    ctx.fillRect(0, 0, w, h);
    drawGrid(ctx, w, h);

    ctx.save();
    ctx.translate(state.view.x, state.view.y);
    ctx.scale(state.view.scale, state.view.scale);

    for (const wire of state.wires) drawWire(ctx, wire, time);

    const drag = state.drag;
    if (drag && drag.type === 'wire') {
      const anchorPos = pinPos(drag.anchor.node, drag.anchor.isOutput, drag.anchor.idx);
      const target = drag.target;
      const end = target ? { x: target.x, y: target.y } : drag.p;
      const g = drag.anchor.isOutput ? bezier(anchorPos, end) : bezier(end, anchorPos);
      traceCurve(ctx, g);
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = target ? COLORS.high : COLORS.select;
      ctx.stroke();
      ctx.setLineDash([]);
      if (target) {
        ctx.beginPath();
        ctx.arc(target.x, target.y, 9, 0, Math.PI * 2);
        ctx.strokeStyle = COLORS.high;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    for (const node of state.nodes) drawNode(ctx, node, time, state.sel.nodes.has(node.id));

    ctx.restore();
  }

  function resize() {
    const r = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    state.size = { w: r.width, h: r.height, dpr };
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
  }

  function toggleClocks() {
    let any = false;
    for (const n of state.nodes) {
      if (n.kind === 'CLOCK') {
        n.value = !n.value;
        any = true;
      }
    }
    if (any) evaluate();
    return any;
  }

  let lastTime = performance.now();

  function frame(time) {
    const dt = Math.min(100, time - lastTime);
    lastTime = time;
    if (state.running) {
      state.clockAcc += dt / 1000;
      const half = 1 / (2 * state.hz);
      let guard = 0;
      while (state.clockAcc >= half && guard < 4) {
        state.clockAcc -= half;
        toggleClocks();
        guard += 1;
      }
      if (guard === 4) state.clockAcc = 0;
    }
    draw(time);
    requestAnimationFrame(frame);
  }

  function setCursor(value) {
    canvas.style.cursor = value;
  }

  function showTip(sx, sy, text) {
    if (!text) {
      tip.hidden = true;
      return;
    }
    tip.textContent = text;
    tip.hidden = false;
    const maxX = state.size.w - tip.offsetWidth - 8;
    tip.style.left = Math.max(4, Math.min(sx + 14, maxX)) + 'px';
    tip.style.top = Math.max(4, sy + 16) + 'px';
  }

  function bit(v) {
    return v ? '1' : '0';
  }

  function describeNode(node) {
    const spec = E.SPECS[node.kind];
    const name = DIM[node.kind].name + (node.label ? ' "' + node.label + '"' : '');
    if (spec.source) return name + '  out=' + bit(level(node.id)) + (node.kind === 'INPUT_SWITCH' ? '  (click to toggle)' : '');
    const ins = [];
    for (let i = 0; i < spec.inputs; i++) ins.push(bit(inputLevel(node, i)));
    if (spec.sink) return name + '  in=' + ins.join(',');
    return name + '  in=' + ins.join(',') + '  out=' + bit(level(node.id));
  }

  function onPointerDown(e) {
    const s = pointerScreen(e);
    const p = screenToWorld(s.x, s.y);

    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      if (e.button === 2 && hitNode(p)) {
        return;
      }
      hideContextMenu();
      closePresetsMenu();
      canvas.setPointerCapture(e.pointerId);
      state.drag = { type: 'pan', sx: s.x, sy: s.y, vx: state.view.x, vy: state.view.y };
      setCursor('grabbing');
      return;
    }
    if (e.button !== 0) return;
    hideContextMenu();
    closePresetsMenu();
    canvas.setPointerCapture(e.pointerId);

    const pin = hitPin(p);
    if (pin) {
      clearSelection();
      if (!pin.isOutput) {
        const existing = wireInto(pin.node.id, pin.idx);
        if (existing) {
          const source = nodeById(existing.from);
          removeWire(existing.id);
          evaluate();
          state.drag = {
            type: 'wire',
            anchor: { node: source, isOutput: true, idx: existing.fromPin },
            p,
            target: null,
            detached: true
          };
          return;
        }
      }
      state.drag = { type: 'wire', anchor: pin, p, target: null, detached: false };
      return;
    }

    const node = hitNode(p);
    if (node) {
      state.sel.wire = null;
      if (e.shiftKey) {
        if (state.sel.nodes.has(node.id)) state.sel.nodes.delete(node.id);
        else state.sel.nodes.add(node.id);
      } else if (!state.sel.nodes.has(node.id)) {
        state.sel.nodes = new Set([node.id]);
      }
      const origins = new Map();
      state.sel.nodes.forEach((id) => {
        const n = nodeById(id);
        origins.set(id, { x: n.x, y: n.y });
      });
      state.drag = { type: 'nodes', node, start: p, sx: s.x, sy: s.y, origins, moved: false, shift: e.shiftKey };
      return;
    }

    const wire = hitWire(p);
    if (wire) {
      state.sel.nodes.clear();
      state.sel.wire = wire.id;
      return;
    }

    if (!e.shiftKey) clearSelection();
    state.drag = { type: 'pan', sx: s.x, sy: s.y, vx: state.view.x, vy: state.view.y };
    setCursor('grabbing');
  }

  function onPointerMove(e) {
    const s = pointerScreen(e);
    const p = screenToWorld(s.x, s.y);
    const drag = state.drag;

    if (drag) {
      tip.hidden = true;
      if (drag.type === 'pan') {
        state.view.x = drag.vx + (s.x - drag.sx);
        state.view.y = drag.vy + (s.y - drag.sy);
      } else if (drag.type === 'nodes') {
        if (!drag.moved && Math.hypot(s.x - drag.sx, s.y - drag.sy) > 3) drag.moved = true;
        if (drag.moved) {
          const dx = p.x - drag.start.x;
          const dy = p.y - drag.start.y;
          drag.origins.forEach((o, id) => {
            const n = nodeById(id);
            n.x = snap(o.x + dx);
            n.y = snap(o.y + dy);
          });
          setCursor('move');
        }
      } else if (drag.type === 'wire') {
        drag.p = p;
        drag.target = hitPin(p, !drag.anchor.isOutput);
        setCursor('crosshair');
      }
      return;
    }

    const pin = hitPin(p);
    if (pin) {
      setCursor('crosshair');
      const wire = pin.isOutput ? null : wireInto(pin.node.id, pin.idx);
      const text = pin.isOutput
        ? 'Output ' + bit(level(pin.node.id)) + ' - drag to an input'
        : 'Input ' + bit(inputLevel(pin.node, pin.idx)) + (wire ? ' - drag to detach' : ' - drag to an output');
      showTip(s.x, s.y, text);
      return;
    }
    const node = hitNode(p);
    if (node) {
      setCursor(node.kind === 'INPUT_SWITCH' ? 'pointer' : 'move');
      showTip(s.x, s.y, describeNode(node));
      return;
    }
    setCursor(hitWire(p) ? 'pointer' : 'grab');
    tip.hidden = true;
  }

  function onPointerUp(e) {
    try {
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
    } catch (_) {}
    const drag = state.drag;
    state.drag = null;
    setCursor('grab');
    if (!drag) return;
    const s = pointerScreen(e);
    const p = screenToWorld(s.x, s.y);

    if (drag.type === 'nodes') {
      if (!drag.moved) {
        if (!drag.shift) state.sel.nodes = new Set([drag.node.id]);
        if (drag.node.kind === 'INPUT_SWITCH' && !drag.shift) {
          drag.node.value = !drag.node.value;
          evaluate();
        }
      }
      return;
    }

    if (drag.type === 'wire') {
      const target = hitPin(p, !drag.anchor.isOutput);
      if (target) {
        if (drag.anchor.isOutput) connect(drag.anchor.node, drag.anchor.idx, target.node, target.idx);
        else connect(target.node, target.idx, drag.anchor.node, drag.anchor.idx);
        evaluate();
        flash('Connected');
        return;
      }
      const wrong = hitPin(p, drag.anchor.isOutput);
      if (wrong) {
        flash('Invalid connection: wire an output pin to an input pin', 'bad');
      } else if (drag.detached) {
        flash('Wire removed');
      }
    }
  }

  function onWheel(e) {
    e.preventDefault();
    hideContextMenu();
    closePresetsMenu();
    const s = pointerScreen(e);
    const before = screenToWorld(s.x, s.y);
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, state.view.scale * factor));
    state.view.scale = scale;
    state.view.x = s.x - before.x * scale;
    state.view.y = s.y - before.y * scale;
    updateInfo();
  }

  function onDoubleClick(e) {
    const s = pointerScreen(e);
    const node = hitNode(screenToWorld(s.x, s.y));
    if (!node) return;
    const next = window.prompt('Label for this component', node.label || '');
    if (next === null) return;
    node.label = next.trim().slice(0, 16);
  }

  function deleteSelection() {
    if (state.sel.wire !== null) {
      removeWire(state.sel.wire);
      state.sel.wire = null;
      evaluate();
      flash('Wire deleted');
      return;
    }
    if (state.sel.nodes.size > 0) {
      const count = state.sel.nodes.size;
      state.sel.nodes.forEach((id) => removeNode(id));
      state.sel.nodes.clear();
      evaluate();
      flash(count + (count === 1 ? ' component deleted' : ' components deleted'));
    }
  }

  function selectAll() {
    state.sel.wire = null;
    state.sel.nodes = new Set(state.nodes.map((n) => n.id));
  }

  function setRunning(value) {
    state.running = value;
    if (runButton) {
      runButton.textContent = value ? 'Pause' : 'Run';
      runButton.classList.toggle('paused', !value);
    }
    flash(value ? 'Clocks running' : 'Clocks paused');
  }

  function showContextMenu(clientX, clientY, node) {
    if (!contextMenu) return;
    activeContextNode = node;
    const kindName = DIM[node.kind] ? DIM[node.kind].name : 'Component';
    if (ctxTitle) {
      ctxTitle.textContent = node.label ? (kindName + ' "' + node.label + '"') : (kindName + ' Gate');
    }
    const delLabel = ctxDelete ? ctxDelete.querySelector('.ctx-label') : null;
    if (delLabel) {
      delLabel.textContent = 'Delete ' + kindName;
    }

    contextMenu.style.position = 'fixed';
    contextMenu.hidden = false;
    contextMenu.style.display = 'flex';
    const menuWidth = 180;
    const menuHeight = 90;
    let left = clientX;
    let top = clientY;
    if (left + menuWidth > window.innerWidth) left = Math.max(10, window.innerWidth - menuWidth - 10);
    if (top + menuHeight > window.innerHeight) top = Math.max(10, window.innerHeight - menuHeight - 10);
    contextMenu.style.left = left + 'px';
    contextMenu.style.top = top + 'px';
  }

  function hideContextMenu() {
    if (contextMenu && !contextMenu.hidden) {
      contextMenu.hidden = true;
      contextMenu.style.display = 'none';
      activeContextNode = null;
    }
  }

  function openPresetsMenu() {
    const dm = document.getElementById('dropdown-presets-menu');
    const db = document.getElementById('dropdown-presets-btn');
    if (dm) {
      dm.hidden = false;
      dm.style.display = 'flex';
    }
    if (db) db.setAttribute('aria-expanded', 'true');
  }

  function closePresetsMenu() {
    const dm = document.getElementById('dropdown-presets-menu');
    const db = document.getElementById('dropdown-presets-btn');
    if (dm) {
      dm.hidden = true;
      dm.style.display = 'none';
    }
    if (db) db.setAttribute('aria-expanded', 'false');
  }

  function togglePresetsMenu() {
    const dm = document.getElementById('dropdown-presets-menu');
    if (!dm) return;
    if (dm.hidden || dm.style.display === 'none') {
      openPresetsMenu();
    } else {
      closePresetsMenu();
    }
  }

  function tick() {
    if (!toggleClocks()) flash('No clock in the circuit');
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'circuit.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    flash('Exported circuit.json');
  }

  function importFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        loadCircuit(JSON.parse(String(reader.result)));
        flash('Imported ' + file.name);
      } catch (error) {
        flash('Import failed: ' + error.message, 'bad');
      }
    };
    reader.onerror = () => flash('Could not read file', 'bad');
    reader.readAsText(file);
  }

  async function saveToServer() {
    try {
      const res = await fetch('/api/circuit/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serialize())
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
      history.replaceState(null, '', '#' + data.id);
      let copied = false;
      try {
        await navigator.clipboard.writeText(location.href);
        copied = true;
      } catch (error) {
        copied = false;
      }
      flash('Saved as ' + data.id + (copied ? ' (link copied)' : ' (link is in the address bar)'), 'ok');
    } catch (error) {
      flash('Save failed: ' + error.message, 'bad');
    }
  }

  async function loadFromServer(id) {
    try {
      const res = await fetch('/api/circuit/' + id);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
      loadCircuit(data);
      flash('Loaded circuit ' + id, 'ok');
      return true;
    } catch (error) {
      flash('Load failed: ' + error.message, 'bad');
      return false;
    }
  }

  function renderTable(table) {
    const holder = document.createElement('div');
    if (table.has_cycle) {
      const note = document.createElement('p');
      note.textContent =
        'This circuit contains feedback. Rows are evaluated in order and carry state from the previous row. Highlighted rows did not settle.';
      holder.appendChild(note);
    }
    const el = document.createElement('table');
    el.className = 'truth';
    const thead = document.createElement('thead');
    const head = document.createElement('tr');
    table.inputs.forEach((port) => {
      const th = document.createElement('th');
      th.textContent = port.label;
      head.appendChild(th);
    });
    table.outputs.forEach((port, i) => {
      const th = document.createElement('th');
      th.textContent = port.label;
      th.className = 'out' + (i === 0 ? ' divider' : '');
      head.appendChild(th);
    });
    thead.appendChild(head);
    el.appendChild(thead);
    const tbody = document.createElement('tbody');
    table.rows.forEach((row) => {
      const tr = document.createElement('tr');
      if (!row.stable) tr.className = 'unstable';
      row.inputs.forEach((v) => {
        const td = document.createElement('td');
        td.textContent = bit(v);
        td.className = v ? 'hi' : 'lo';
        tr.appendChild(td);
      });
      row.outputs.forEach((v, i) => {
        const td = document.createElement('td');
        td.textContent = bit(v);
        td.className = (v ? 'hi' : 'lo') + (i === 0 ? ' divider' : '');
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    el.appendChild(tbody);
    holder.appendChild(el);
    return holder;
  }

  async function showTruthTable() {
    tableBody.replaceChildren();
    const loading = document.createElement('p');
    loading.textContent = 'Computing...';
    tableBody.appendChild(loading);
    if (!dialog.open) dialog.showModal();
    try {
      const res = await fetch('/api/truth-table', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serialize())
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
      tableBody.replaceChildren(renderTable(data));
    } catch (error) {
      const message = document.createElement('p');
      message.className = 'error';
      message.textContent = 'Could not generate truth table: ' + error.message;
      tableBody.replaceChildren(message);
    }
  }

  function addFromPalette(kind) {
    const w = state.size.w;
    const h = state.size.h;
    const center = screenToWorld(w / 2, h / 2);
    const offset = (state.spawn++ % 6) * GRID;
    const d = DIM[kind];
    const node = addNode(kind, center.x - d.w / 2 + offset, center.y - d.h / 2 + offset);
    state.sel.nodes = new Set([node.id]);
    state.sel.wire = null;
    evaluate();
  }

  function drawIcon(iconCanvas, kind) {
    const dpr = window.devicePixelRatio || 1;
    iconCanvas.width = 64 * dpr;
    iconCanvas.height = 44 * dpr;
    const c = iconCanvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const d = DIM[kind];
    const scale = Math.min(52 / d.w, 36 / d.h);
    c.translate((64 - d.w * scale) / 2, (44 - d.h * scale) / 2);
    c.scale(scale, scale);
    drawBody(c, { kind, id: -1 }, false, 0);
  }

  function buildPalette() {
    const root = document.getElementById('palette');
    for (const [title, kinds] of GROUPS) {
      const section = document.createElement('section');
      const heading = document.createElement('h3');
      heading.textContent = title;
      section.appendChild(heading);
      const grid = document.createElement('div');
      grid.className = 'palette-grid';
      for (const kind of kinds) {
        const item = document.createElement('div');
        item.className = 'palette-item';
        item.draggable = true;
        item.dataset.kind = kind;
        item.title = 'Drag onto the canvas or click to add a ' + DIM[kind].name;
        const icon = document.createElement('canvas');
        drawIcon(icon, kind);
        const name = document.createElement('span');
        name.textContent = DIM[kind].name;
        item.appendChild(icon);
        item.appendChild(name);
        item.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', kind);
          e.dataTransfer.effectAllowed = 'copy';
        });
        item.addEventListener('click', () => addFromPalette(kind));
        grid.appendChild(item);
      }
      section.appendChild(grid);
      root.appendChild(section);
    }
  }

  function buildPresets() {
    if (presetSelect) {
      Object.keys(P.PRESETS).forEach((name) => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        presetSelect.appendChild(option);
      });
      presetSelect.addEventListener('change', () => {
        const name = presetSelect.value;
        presetSelect.value = '';
        if (!name || !P.PRESETS[name]) return;
        loadCircuit(P.PRESETS[name]());
        history.replaceState(null, '', location.pathname);
        flash('Loaded preset: ' + name);
      });
    }

    const dropdownBtn = document.getElementById('dropdown-presets-btn');
    const dropdownMenu = document.getElementById('dropdown-presets-menu');
    if (dropdownBtn && dropdownMenu) {
      closePresetsMenu();

      dropdownBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        togglePresetsMenu();
      });

      dropdownMenu.querySelectorAll('.dropdown-option').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const name = btn.dataset.preset;
          closePresetsMenu();
          if (!name || !P.PRESETS[name]) return;
          loadCircuit(P.PRESETS[name]());
          history.replaceState(null, '', location.pathname);
          flash('Loaded preset: ' + name);
        });
      });

      window.addEventListener('pointerdown', (e) => {
        if (!dropdownMenu.hidden && dropdownMenu.style.display !== 'none') {
          if (dropdownBtn.contains(e.target) || dropdownMenu.contains(e.target)) return;
          closePresetsMenu();
        }
      });

      window.addEventListener('click', (e) => {
        if (!dropdownMenu.hidden && dropdownMenu.style.display !== 'none') {
          if (dropdownBtn.contains(e.target) || dropdownMenu.contains(e.target)) return;
          closePresetsMenu();
        }
      });
    }
  }

  function bindEvents() {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', () => {
      state.drag = null;
      setCursor('grab');
    });
    canvas.addEventListener('pointerleave', () => {
      if (!state.drag) tip.hidden = true;
    });
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', (e) => {
      hideContextMenu();
      onDoubleClick(e);
    });
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const s = pointerScreen(e);
      const p = screenToWorld(s.x, s.y);
      const node = hitNode(p);
      if (node) {
        state.sel.nodes = new Set([node.id]);
        state.sel.wire = null;
        showContextMenu(e.clientX, e.clientY, node);
      } else {
        hideContextMenu();
      }
    });

    function executeContextDelete(e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (activeContextNode) {
        const name = DIM[activeContextNode.kind] ? DIM[activeContextNode.kind].name : 'Component';
        removeNode(activeContextNode.id);
        state.sel.nodes.delete(activeContextNode.id);
        evaluate();
        flash(name + ' deleted');
      }
      hideContextMenu();
    }

    if (ctxDelete) {
      ctxDelete.addEventListener('click', executeContextDelete);
      ctxDelete.addEventListener('pointerdown', executeContextDelete);
    }

    if (ctxRename) {
      ctxRename.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const nodeToRename = activeContextNode;
        hideContextMenu();
        if (nodeToRename) {
          const next = window.prompt('Label for this component', nodeToRename.label || '');
          if (next !== null) {
            nodeToRename.label = next.trim().slice(0, 16);
          }
        }
      });
    }

    if (contextMenu) {
      contextMenu.addEventListener('pointerdown', (e) => e.stopPropagation());
      contextMenu.addEventListener('mousedown', (e) => e.stopPropagation());
      contextMenu.addEventListener('click', (e) => e.stopPropagation());
    }

    window.addEventListener('pointerdown', (e) => {
      if (contextMenu && !contextMenu.hidden && !contextMenu.contains(e.target)) {
        hideContextMenu();
      }
    });

    stage.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    stage.addEventListener('drop', (e) => {
      e.preventDefault();
      const kind = e.dataTransfer.getData('text/plain');
      if (!DIM[kind]) return;
      const r = canvas.getBoundingClientRect();
      const p = screenToWorld(e.clientX - r.left, e.clientY - r.top);
      const d = DIM[kind];
      const node = addNode(kind, p.x - d.w / 2, p.y - d.h / 2);
      state.sel.nodes = new Set([node.id]);
      state.sel.wire = null;
      evaluate();
    });

    if (runButton) {
      runButton.addEventListener('click', () => {
        setRunning(!state.running);
        runButton.blur();
      });
    }
    const btnTick = document.getElementById('btn-tick');
    if (btnTick) {
      btnTick.addEventListener('click', (e) => {
        tick();
        e.currentTarget.blur();
      });
    }
    if (speedInput) {
      speedInput.addEventListener('input', () => {
        state.hz = Number(speedInput.value);
        if (speedLabel) speedLabel.textContent = state.hz + ' Hz';
      });
    }
    document.getElementById('btn-clear').addEventListener('click', (e) => {
      e.currentTarget.blur();
      if (state.nodes.length > 0 && !window.confirm('Remove every component from the canvas?')) return;
      loadCircuit({ nodes: [], wires: [] });
      history.replaceState(null, '', location.pathname);
      flash('Canvas cleared');
    });
    document.getElementById('btn-export').addEventListener('click', exportJson);
    document.getElementById('btn-import').addEventListener('click', () => fileInput.click());
    const btnSave = document.getElementById('btn-save');
    if (btnSave) btnSave.addEventListener('click', saveToServer);
    document.getElementById('btn-fit').addEventListener('click', fitView);
    document.getElementById('btn-table').addEventListener('click', showTruthTable);
    document.getElementById('table-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      fileInput.value = '';
      if (file) importFile(file);
    });

    window.addEventListener('keydown', (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (dialog.open) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
      } else if (e.key === ' ') {
        e.preventDefault();
        setRunning(!state.running);
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        exportJson();
      } else if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        fileInput.click();
      } else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAll();
      } else if (!mod && e.key.toLowerCase() === 't') {
        tick();
      } else if (!mod && e.key.toLowerCase() === 'f') {
        fitView();
      } else if (e.key === 'Escape') {
        hideContextMenu();
        closePresetsMenu();
        state.drag = null;
        clearSelection();
      }
    });

    new ResizeObserver(resize).observe(stage);
    window.addEventListener('resize', resize);
  }

  async function start() {
    buildPalette();
    buildPresets();
    bindEvents();
    resize();
    setCursor('grab');

    const id = location.hash.replace('#', '');
    let loaded = false;
    if (/^[0-9a-f]{1,32}$/.test(id)) loaded = await loadFromServer(id);
    if (!loaded) loadCircuit(P.PRESETS['Half Adder']());
    updateInfo();
    requestAnimationFrame(frame);
  }

  start();
})();
