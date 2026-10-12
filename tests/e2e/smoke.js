const { JSDOM } = require('jsdom');
const URLBASE = process.env.BASE_URL || 'http://127.0.0.1:3000/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures++; };
const errors = [];
let lastBlob = null;

(async () => {
  const dom = await JSDOM.fromURL(URLBASE, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(window) {
      const noop = () => undefined;
      window.HTMLCanvasElement.prototype.getContext = function () {
        return new Proxy({}, { get: (t, p) => (p in t ? t[p] : noop), set: (t, p, v) => ((t[p] = v), true) });
      };
      window.Element.prototype.setPointerCapture = noop;
      window.Element.prototype.getBoundingClientRect = function () {
        return { left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700, x: 0, y: 0 };
      };
      window.ResizeObserver = class { constructor(cb) { this.cb = cb; } observe() { this.cb(); } };
      window.fetch = (u, o) => fetch(new URL(u, URLBASE), o);
      window.confirm = () => true;
      window.prompt = () => 'Z';
      window.URL.createObjectURL = (b) => { lastBlob = b; return 'blob:test'; };
      window.URL.revokeObjectURL = noop;
      window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
      window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
      window.HTMLAnchorElement.prototype.click = noop;
      window.addEventListener('error', (e) => errors.push(e.message));
    }
  });
  const w = dom.window;
  const d = w.document;
  const $ = (id) => d.getElementById(id);
  const info = () => $('status-info').textContent;
  const msg = () => $('status-msg').textContent;

  async function waitFor(fn, ms = 6000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(50); }
    return false;
  }

  ok(await waitFor(() => /6 nodes \| 6 wires/.test(info())), 'half adder preset loads on start: ' + info());
  ok(await waitFor(() => /backend: verified/.test(info())), 'backend validation verifies client result');
  ok(d.querySelectorAll('.palette-item').length === 11, 'palette lists 11 components');
  ok($('presets').options.length === 5, 'presets dropdown has 4 presets');

  function ptr(type, x, y, extra) {
    const e = new w.MouseEvent(type, Object.assign({ bubbles: true, clientX: x, clientY: y, button: 0 }, extra || {}));
    Object.defineProperty(e, 'pointerId', { value: 1 });
    $('canvas').dispatchEvent(e);
  }
  const click = (x, y, extra) => { ptr('pointerdown', x, y, extra); ptr('pointerup', x, y, extra); };
  const drag = (x0, y0, x1, y1) => { ptr('pointerdown', x0, y0); ptr('pointermove', (x0 + x1) / 2, (y0 + y1) / 2); ptr('pointermove', x1, y1); ptr('pointerup', x1, y1); };
  function drop(kind, x, y) {
    const e = new w.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clientX', { value: x });
    Object.defineProperty(e, 'clientY', { value: y });
    Object.defineProperty(e, 'dataTransfer', { value: { getData: () => kind } });
    $('stage').dispatchEvent(e);
  }
  async function exported() {
    $('btn-export').click();
    return JSON.parse(await lastBlob.text());
  }

  const half = await exported();
  const swA = half.nodes.find((n) => n.label === 'A');
  ok(swA.value === true, 'export contains switch A = 1');
  click(227, 252);
  const half2 = await exported();
  ok(half2.nodes.find((n) => n.label === 'A').value === false, 'clicking switch A toggles it to 0');
  ok(await waitFor(() => /backend: verified/.test(info())), 'backend still verified after toggle');

  $('presets').value = 'Full Adder';
  $('presets').dispatchEvent(new w.Event('change'));
  ok(/10 nodes \| 12 wires/.test(info()), 'Full Adder preset loads: ' + info());
  $('presets').value = 'SR Latch';
  $('presets').dispatchEvent(new w.Event('change'));
  ok(/6 nodes \| 6 wires/.test(info()) && /feedback/.test(info()), 'SR Latch preset loads with feedback flag: ' + info());
  ok(await waitFor(() => /backend: verified/.test(info())), 'backend verifies SR latch');

  $('btn-clear').click();
  ok(/0 nodes \| 0 wires/.test(info()), 'clear empties canvas');

  drop('INPUT_SWITCH', 200, 200);
  drop('NOT', 400, 200);
  drop('OUTPUT_LED', 600, 200);
  ok(/3 nodes/.test(info()), 'drag-and-drop from palette places 3 nodes: ' + info());

  drag(240, 200, 360, 200);
  drag(430, 200, 580, 200);
  ok(/2 wires/.test(info()), 'dragging output pin to input pin creates wires: ' + info());

  drag(430, 200, 240, 200);
  ok(/Invalid connection/.test(msg()), 'output-to-output connection is rejected: ' + msg());
  ok(/2 wires/.test(info()), 'invalid drop does not add a wire');

  drag(580, 200, 590, 260);
  ok(/1 wires/.test(info()), 'dragging a connected input pin off removes the wire: ' + info());
  drag(430, 200, 580, 200);
  ok(/2 wires/.test(info()), 'wire re-created');

  click(210, 200);
  const state1 = await exported();
  ok(state1.nodes.find((n) => n.kind === 'INPUT_SWITCH').value === true, 'switch toggled on in drawn circuit');
  ok(await waitFor(() => /backend: verified/.test(info())), 'backend verified drawn circuit');

  $('btn-table').click();
  ok(await waitFor(() => d.querySelectorAll('#table-body table.truth tbody tr').length === 2), 'truth table modal renders 2 rows');
  const cells = [...d.querySelectorAll('#table-body table.truth tbody tr')].map((r) => [...r.children].map((c) => c.textContent).join(''));
  ok(cells.join(',') === '01,10', 'NOT truth table is 0->1, 1->0: ' + cells.join(','));
  const heads = [...d.querySelectorAll('#table-body th')].map((c) => c.textContent);
  ok(heads.join(',') === 'A,Y', 'truth table uses default labels: ' + heads.join(','));
  $('table-close').click();

  click(395, 190);
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  ok(/2 nodes \| 0 wires/.test(info()), 'deleting a node also removes its wires: ' + info());

  const before = $('btn-run').textContent;
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  ok(before === 'Pause' && $('btn-run').textContent === 'Run', 'space toggles run/pause');
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: ' ', bubbles: true }));

  const z0 = info().match(/(\d+)%$/)[1];
  $('canvas').dispatchEvent(new w.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 500, clientY: 300, deltaY: -200 }));
  const z1 = info().match(/(\d+)%$/)[1];
  ok(Number(z1) > Number(z0), 'wheel zooms in: ' + z0 + '% -> ' + z1 + '%');

  drop('CLOCK', 300, 300);
  drop('OUTPUT_LED', 500, 300);
  const clockWorldNodes = (await exported()).nodes;
  const clk = clockWorldNodes.find((n) => n.kind === 'CLOCK');
  $('btn-tick').click();
  const clk2 = (await exported()).nodes.find((n) => n.kind === 'CLOCK');
  ok(clk.value !== clk2.value, 'tick toggles the clock');
  $('speed').value = '10';
  $('speed').dispatchEvent(new w.Event('input'));
  ok($('speed-label').textContent === '10 Hz', 'clock speed slider updates label');

  const snapshot = await exported();
  const file = new w.File([JSON.stringify(snapshot)], 'c.json', { type: 'application/json' });
  Object.defineProperty($('file'), 'files', { value: [file], configurable: true });
  $('file').dispatchEvent(new w.Event('change'));
  ok(await waitFor(() => /Imported c.json/.test(msg())), 'import loads a JSON file: ' + msg());
  ok(new RegExp(snapshot.nodes.length + ' nodes').test(info()), 'imported node count matches');

  Object.defineProperty($('file'), 'files', { value: [new w.File(['{bad'], 'bad.json')], configurable: true });
  $('file').dispatchEvent(new w.Event('change'));
  ok(await waitFor(() => /Import failed/.test(msg())), 'invalid import shows an error: ' + msg());

  $('btn-save').click();
  ok(await waitFor(() => /Saved as [0-9a-f]+/.test(msg())), 'save to server reports an id: ' + msg());
  ok(/^#[0-9a-f]+$/.test(w.location.hash), 'location hash set to circuit id: ' + w.location.hash);

  await sleep(300);
  ok(errors.length === 0, 'no uncaught page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log(failures === 0 ? '\nALL SMOKE CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED');
  w.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
