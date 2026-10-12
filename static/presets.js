(function (root) {
  'use strict';

  function make(nodeSpecs, wireSpecs) {
    const nodes = nodeSpecs.map((spec, i) => ({
      id: i + 1,
      kind: spec[0],
      x: spec[1],
      y: spec[2],
      value: spec[4] === true,
      label: spec[3] || ''
    }));
    const wires = wireSpecs.map((spec, i) => ({
      id: i + 1,
      from: spec[0] + 1,
      from_pin: 0,
      to: spec[1] + 1,
      to_pin: spec[2]
    }));
    return { version: 1, nodes, wires };
  }

  const PRESETS = {
    'Half Adder': () =>
      make(
        [
          ['INPUT_SWITCH', 60, 60, 'A', true],
          ['INPUT_SWITCH', 60, 180, 'B', true],
          ['XOR', 260, 60, ''],
          ['AND', 260, 180, ''],
          ['OUTPUT_LED', 460, 80, 'S'],
          ['OUTPUT_LED', 460, 200, 'C']
        ],
        [
          [0, 2, 0],
          [1, 2, 1],
          [0, 3, 0],
          [1, 3, 1],
          [2, 4, 0],
          [3, 5, 0]
        ]
      ),

    'Full Adder': () =>
      make(
        [
          ['INPUT_SWITCH', 40, 40, 'A', true],
          ['INPUT_SWITCH', 40, 140, 'B', true],
          ['INPUT_SWITCH', 40, 280, 'Cin', true],
          ['XOR', 220, 60, ''],
          ['XOR', 420, 80, ''],
          ['AND', 220, 200, ''],
          ['AND', 420, 240, ''],
          ['OR', 620, 220, ''],
          ['OUTPUT_LED', 640, 80, 'S'],
          ['OUTPUT_LED', 800, 240, 'Cout']
        ],
        [
          [0, 3, 0],
          [1, 3, 1],
          [3, 4, 0],
          [2, 4, 1],
          [0, 5, 0],
          [1, 5, 1],
          [3, 6, 0],
          [2, 6, 1],
          [5, 7, 0],
          [6, 7, 1],
          [4, 8, 0],
          [7, 9, 0]
        ]
      ),

    'SR Latch': () =>
      make(
        [
          ['INPUT_SWITCH', 40, 40, 'R'],
          ['INPUT_SWITCH', 40, 220, 'S'],
          ['NOR', 260, 40, ''],
          ['NOR', 260, 220, ''],
          ['OUTPUT_LED', 460, 60, 'Q'],
          ['OUTPUT_LED', 460, 240, 'Qn']
        ],
        [
          [0, 2, 0],
          [3, 2, 1],
          [2, 3, 0],
          [1, 3, 1],
          [2, 4, 0],
          [3, 5, 0]
        ]
      ),

    'XOR from NANDs': () =>
      make(
        [
          ['INPUT_SWITCH', 40, 60, 'A', true],
          ['INPUT_SWITCH', 40, 200, 'B'],
          ['NAND', 200, 120, ''],
          ['NAND', 380, 40, ''],
          ['NAND', 380, 200, ''],
          ['NAND', 560, 120, ''],
          ['OUTPUT_LED', 740, 140, 'Y']
        ],
        [
          [0, 2, 0],
          [1, 2, 1],
          [0, 3, 0],
          [2, 3, 1],
          [2, 4, 0],
          [1, 4, 1],
          [3, 5, 0],
          [4, 5, 1],
          [5, 6, 0]
        ]
      )
  };

  const api = { PRESETS, make, coreOrigin: 'anshumanj28' };
  root.LogicPresets = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
