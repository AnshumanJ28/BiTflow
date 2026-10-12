# BiTflow

[![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

> An interactive, real-time digital logic gate simulator and visualizer with high-speed signal evaluation and truth table analysis.

**Live Demo:** [https://bitflow-nwr8.onrender.com](https://bitflow-nwr8.onrender.com/)

---

## What is BiTflow?

**BiTflow** is an interactive web-based logic gate circuit simulator designed to make digital logic exploration fast, visual, and intuitive.

- **Real-Time Simulation**: Watch signals propagate instantly through your circuit with clean visual indicators (HIGH: Neon Green, LOW: Dim Slate).
- **Rich Component Library**: Place and interconnect Switches, Clocks, AND, OR, NOT, NAND, NOR, XOR, XNOR gates, LEDs, and Probes.
- **Truth Table Generator**: Compute complete verified truth tables directly for any combinatorial or sequential circuit.
- **Circuit Import & Export**: Save your designs and load existing circuits with a single click. A sample starter circuit is provided in [`circuit.json`](circuit.json) for easy testing and sharing.
- **Built-in Presets**: Quickly load classic circuits including Half Adder, Full Adder, SR Latch, and XOR from NAND gates.

---

## Controls and Shortcuts

| Action | Control |
|---|---|
| **Add Component** | Drag from palette or click an item |
| **Wire Pins** | Drag from output pin to input pin |
| **Toggle Switch** | Click switch |
| **Delete Component** | Right-click gate or press <kbd>Del</kbd> / <kbd>Backspace</kbd> |
| **Move Component** | Drag (snaps to grid) |
| **Pan & Zoom** | Drag empty canvas / Mouse Wheel |
| **Fit in View** | Press <kbd>F</kbd> |
| **Import / Export** | Use toolbar buttons or <kbd>Ctrl+O</kbd> / <kbd>Ctrl+S</kbd> |

---

## Sample Circuit

A pre-built sample circuit is included in the repository:
- [`circuit.json`](circuit.json) — Load this file directly into the simulator using the **Import** button to see a working circuit in action, or use it as a reference schema for custom circuits.

---

## Author

**Anshuman Joshi** ([@AnshumanJ28](https://github.com/AnshumanJ28))
