use std::collections::{HashMap, HashSet, VecDeque};

use serde::Serialize;

use crate::circuit::{Circuit, CircuitError, Node};

pub const MAX_SWEEPS: usize = 100;
pub const MAX_TABLE_INPUTS: usize = 16;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SimResult {
    pub node_states: HashMap<u32, bool>,
    pub wire_states: HashMap<u32, bool>,
    pub stable: bool,
    pub oscillating: bool,
    pub has_cycle: bool,
    pub sweeps: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PortInfo {
    pub id: u32,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TruthRow {
    pub inputs: Vec<bool>,
    pub outputs: Vec<bool>,
    pub stable: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TruthTable {
    pub inputs: Vec<PortInfo>,
    pub outputs: Vec<PortInfo>,
    pub rows: Vec<TruthRow>,
    pub has_cycle: bool,
}

pub struct Run {
    pub levels: Vec<bool>,
    pub stable: bool,
    pub oscillating: bool,
    pub sweeps: usize,
}

pub struct Engine<'a> {
    nodes: Vec<&'a Node>,
    order: Vec<usize>,
    drivers: Vec<Vec<Option<usize>>>,
    wires: Vec<(u32, usize)>,
    pub has_cycle: bool,
}

impl<'a> Engine<'a> {
    pub fn new(circuit: &'a Circuit) -> Result<Self, CircuitError> {
        circuit.validate()?;

        let mut nodes: Vec<&Node> = circuit.nodes.iter().collect();
        nodes.sort_by_key(|n| n.id);
        let n = nodes.len();

        let positions: HashMap<u32, usize> =
            nodes.iter().enumerate().map(|(i, node)| (node.id, i)).collect();

        let mut drivers: Vec<Vec<Option<usize>>> = nodes
            .iter()
            .map(|node| vec![None; node.kind.input_count()])
            .collect();
        let mut indegree = vec![0usize; n];
        let mut adjacency: Vec<Vec<usize>> = vec![Vec::new(); n];
        let mut wires = Vec::with_capacity(circuit.wires.len());

        for wire in &circuit.wires {
            let from = positions[&wire.from];
            let to = positions[&wire.to];
            drivers[to][wire.to_pin] = Some(from);
            indegree[to] += 1;
            adjacency[from].push(to);
            wires.push((wire.id, from));
        }

        let mut queue: VecDeque<usize> = (0..n).filter(|&i| indegree[i] == 0).collect();
        let mut order = Vec::with_capacity(n);
        let mut placed = vec![false; n];
        while let Some(i) = queue.pop_front() {
            placed[i] = true;
            order.push(i);
            for &t in &adjacency[i] {
                indegree[t] -= 1;
                if indegree[t] == 0 {
                    queue.push_back(t);
                }
            }
        }
        let has_cycle = order.len() < n;
        for (i, was_placed) in placed.iter().enumerate() {
            if !was_placed {
                order.push(i);
            }
        }

        Ok(Engine {
            nodes,
            order,
            drivers,
            wires,
            has_cycle,
        })
    }

    #[allow(dead_code)]
    pub const CORE_SIG: &'static str = "anshumanj28-bitflow-core";

    pub fn node_values(&self) -> Vec<bool> {
        self.nodes.iter().map(|n| n.value).collect()
    }

    pub fn levels_from_map(&self, map: &HashMap<u32, bool>) -> Vec<bool> {
        self.nodes
            .iter()
            .map(|n| map.get(&n.id).copied().unwrap_or(false))
            .collect()
    }

    pub fn run(&self, sources: &[bool], previous: Option<&[bool]>) -> Run {
        let n = self.nodes.len();
        let mut levels = match previous {
            Some(prev) if prev.len() == n => prev.to_vec(),
            _ => vec![false; n],
        };

        let mut seen: HashSet<Vec<bool>> = HashSet::new();
        let mut sweeps = 0;
        let mut stable = false;
        let mut oscillating = false;

        loop {
            sweeps += 1;
            let mut changed = false;
            for &p in &self.order {
                let node = self.nodes[p];
                let next = if node.kind.is_source() {
                    sources[p]
                } else {
                    let mut inputs = [false; 2];
                    for (k, driver) in self.drivers[p].iter().enumerate() {
                        inputs[k] = driver.map(|q| levels[q]).unwrap_or(false);
                    }
                    node.kind.evaluate(&inputs[..self.drivers[p].len()])
                };
                if next != levels[p] {
                    levels[p] = next;
                    changed = true;
                }
            }
            if !changed {
                stable = true;
                break;
            }
            if !seen.insert(levels.clone()) || sweeps >= MAX_SWEEPS {
                oscillating = true;
                break;
            }
        }

        Run {
            levels,
            stable,
            oscillating,
            sweeps,
        }
    }

    pub fn result(&self, run: &Run) -> SimResult {
        let node_states = self
            .nodes
            .iter()
            .enumerate()
            .map(|(i, node)| (node.id, run.levels[i]))
            .collect();
        let wire_states = self
            .wires
            .iter()
            .map(|&(id, from)| (id, run.levels[from]))
            .collect();
        SimResult {
            node_states,
            wire_states,
            stable: run.stable,
            oscillating: run.oscillating,
            has_cycle: self.has_cycle,
            sweeps: run.sweeps,
        }
    }
}

pub fn simulate(
    circuit: &Circuit,
    previous: Option<&HashMap<u32, bool>>,
) -> Result<SimResult, CircuitError> {
    let engine = Engine::new(circuit)?;
    let sources = engine.node_values();
    let prev = previous.map(|map| engine.levels_from_map(map));
    let run = engine.run(&sources, prev.as_deref());
    Ok(engine.result(&run))
}

fn sorted_ports(engine: &Engine, positions: Vec<usize>) -> Vec<usize> {
    let mut positions = positions;
    positions.sort_by(|&a, &b| {
        let na = engine.nodes[a];
        let nb = engine.nodes[b];
        na.y.total_cmp(&nb.y)
            .then(na.x.total_cmp(&nb.x))
            .then(na.id.cmp(&nb.id))
    });
    positions
}

pub fn truth_table(circuit: &Circuit) -> Result<TruthTable, CircuitError> {
    let engine = Engine::new(circuit)?;

    let input_positions = sorted_ports(
        &engine,
        (0..engine.nodes.len())
            .filter(|&i| engine.nodes[i].kind.is_source())
            .collect(),
    );
    let output_positions = sorted_ports(
        &engine,
        (0..engine.nodes.len())
            .filter(|&i| engine.nodes[i].kind.is_sink())
            .collect(),
    );

    if input_positions.len() > MAX_TABLE_INPUTS {
        return Err(CircuitError(format!(
            "too many inputs for a truth table ({} found, max {})",
            input_positions.len(),
            MAX_TABLE_INPUTS
        )));
    }
    if output_positions.is_empty() {
        return Err(CircuitError(
            "circuit has no outputs (add an LED or probe)".to_string(),
        ));
    }

    let port = |p: usize| PortInfo {
        id: engine.nodes[p].id,
        label: engine.nodes[p].display_label(),
    };
    let inputs: Vec<PortInfo> = input_positions.iter().map(|&p| port(p)).collect();
    let outputs: Vec<PortInfo> = output_positions.iter().map(|&p| port(p)).collect();

    let width = input_positions.len();
    let mut sources = engine.node_values();
    let mut carried: Option<Vec<bool>> = None;
    let mut rows = Vec::with_capacity(1usize << width);

    for row in 0..(1u32 << width) {
        let mut row_inputs = Vec::with_capacity(width);
        for (k, &p) in input_positions.iter().enumerate() {
            let bit = (row >> (width - 1 - k)) & 1 == 1;
            sources[p] = bit;
            row_inputs.push(bit);
        }
        let run = engine.run(&sources, carried.as_deref());
        let row_outputs = output_positions.iter().map(|&p| run.levels[p]).collect();
        rows.push(TruthRow {
            inputs: row_inputs,
            outputs: row_outputs,
            stable: run.stable,
        });
        if engine.has_cycle {
            carried = Some(run.levels);
        }
    }

    Ok(TruthTable {
        inputs,
        outputs,
        rows,
        has_cycle: engine.has_cycle,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::circuit::{NodeKind, Wire};

    struct Builder {
        circuit: Circuit,
        next_node: u32,
        next_wire: u32,
    }

    impl Builder {
        fn new() -> Self {
            Builder {
                circuit: Circuit::default(),
                next_node: 1,
                next_wire: 1,
            }
        }

        fn node(&mut self, kind: NodeKind, value: bool) -> u32 {
            self.node_at(kind, value, 0.0, 0.0)
        }

        fn node_at(&mut self, kind: NodeKind, value: bool, x: f64, y: f64) -> u32 {
            let id = self.next_node;
            self.next_node += 1;
            self.circuit.nodes.push(Node {
                id,
                kind,
                x,
                y,
                value,
                label: None,
            });
            id
        }

        fn wire(&mut self, from: u32, to: u32, to_pin: usize) {
            let id = self.next_wire;
            self.next_wire += 1;
            self.circuit.wires.push(Wire {
                id,
                from,
                from_pin: 0,
                to,
                to_pin,
            });
        }

        fn set(&mut self, id: u32, value: bool) {
            for node in &mut self.circuit.nodes {
                if node.id == id {
                    node.value = value;
                }
            }
        }

        fn level(&self, id: u32) -> bool {
            simulate(&self.circuit, None).unwrap().node_states[&id]
        }
    }

    fn gate_output(kind: NodeKind, a: bool, b: bool) -> bool {
        let mut c = Builder::new();
        let sa = c.node(NodeKind::InputSwitch, a);
        let sb = c.node(NodeKind::InputSwitch, b);
        let gate = c.node(kind, false);
        let led = c.node(NodeKind::OutputLed, false);
        c.wire(sa, gate, 0);
        if kind.input_count() == 2 {
            c.wire(sb, gate, 1);
        }
        c.wire(gate, led, 0);
        c.level(led)
    }

    #[test]
    fn every_gate_matches_its_truth_table() {
        let cases = [(false, false), (false, true), (true, false), (true, true)];
        for (a, b) in cases {
            assert_eq!(gate_output(NodeKind::And, a, b), a && b);
            assert_eq!(gate_output(NodeKind::Or, a, b), a || b);
            assert_eq!(gate_output(NodeKind::Nand, a, b), !(a && b));
            assert_eq!(gate_output(NodeKind::Nor, a, b), !(a || b));
            assert_eq!(gate_output(NodeKind::Xor, a, b), a ^ b);
            assert_eq!(gate_output(NodeKind::Xnor, a, b), !(a ^ b));
            assert_eq!(gate_output(NodeKind::Not, a, b), !a);
        }
    }

    #[test]
    fn unconnected_inputs_float_low() {
        let mut c = Builder::new();
        let sw = c.node(NodeKind::InputSwitch, true);
        let and = c.node(NodeKind::And, false);
        let not = c.node(NodeKind::Not, false);
        let led_and = c.node(NodeKind::OutputLed, false);
        let led_not = c.node(NodeKind::OutputLed, false);
        c.wire(sw, and, 0);
        c.wire(and, led_and, 0);
        c.wire(not, led_not, 0);
        assert!(!c.level(led_and));
        assert!(c.level(led_not));
    }

    #[test]
    fn unconnected_led_reads_low() {
        let mut c = Builder::new();
        let led = c.node(NodeKind::OutputLed, false);
        assert!(!c.level(led));
    }

    #[test]
    fn clock_acts_as_a_source() {
        let mut c = Builder::new();
        let clk = c.node(NodeKind::Clock, true);
        let probe = c.node(NodeKind::Probe, false);
        c.wire(clk, probe, 0);
        assert!(c.level(probe));
        c.set(clk, false);
        assert!(!c.level(probe));
    }

    #[test]
    fn dag_settles_without_feedback_flags() {
        let mut c = Builder::new();
        let sw = c.node(NodeKind::InputSwitch, true);
        let n1 = c.node(NodeKind::Not, false);
        let n2 = c.node(NodeKind::Not, false);
        let led = c.node(NodeKind::OutputLed, false);
        c.wire(n2, led, 0);
        c.wire(n1, n2, 0);
        c.wire(sw, n1, 0);
        let result = simulate(&c.circuit, None).unwrap();
        assert!(result.stable);
        assert!(!result.has_cycle);
        assert!(!result.oscillating);
        assert!(result.node_states[&led]);
        assert_eq!(result.wire_states[&1], true);
        assert_eq!(result.wire_states[&2], false);
    }

    fn half_adder() -> (Circuit, u32, u32) {
        let mut c = Builder::new();
        let a = c.node_at(NodeKind::InputSwitch, false, 0.0, 0.0);
        let b = c.node_at(NodeKind::InputSwitch, false, 0.0, 100.0);
        let xor = c.node(NodeKind::Xor, false);
        let and = c.node(NodeKind::And, false);
        let sum = c.node_at(NodeKind::OutputLed, false, 300.0, 0.0);
        let carry = c.node_at(NodeKind::OutputLed, false, 300.0, 100.0);
        c.wire(a, xor, 0);
        c.wire(b, xor, 1);
        c.wire(a, and, 0);
        c.wire(b, and, 1);
        c.wire(xor, sum, 0);
        c.wire(and, carry, 0);
        (c.circuit, sum, carry)
    }

    #[test]
    fn half_adder_truth_table() {
        let (circuit, sum, carry) = half_adder();
        let table = truth_table(&circuit).unwrap();
        assert_eq!(table.inputs.len(), 2);
        assert_eq!(table.outputs.len(), 2);
        assert_eq!(table.outputs[0].id, sum);
        assert_eq!(table.outputs[1].id, carry);
        assert_eq!(table.rows.len(), 4);
        assert!(!table.has_cycle);
        for (i, row) in table.rows.iter().enumerate() {
            let a = i & 2 != 0;
            let b = i & 1 != 0;
            assert_eq!(row.inputs, vec![a, b]);
            assert_eq!(row.outputs, vec![a ^ b, a && b]);
            assert!(row.stable);
        }
    }

    #[test]
    fn full_adder_truth_table() {
        let mut c = Builder::new();
        let a = c.node_at(NodeKind::InputSwitch, false, 0.0, 0.0);
        let b = c.node_at(NodeKind::InputSwitch, false, 0.0, 100.0);
        let cin = c.node_at(NodeKind::InputSwitch, false, 0.0, 200.0);
        let x1 = c.node(NodeKind::Xor, false);
        let x2 = c.node(NodeKind::Xor, false);
        let a1 = c.node(NodeKind::And, false);
        let a2 = c.node(NodeKind::And, false);
        let or = c.node(NodeKind::Or, false);
        let sum = c.node_at(NodeKind::OutputLed, false, 500.0, 0.0);
        let cout = c.node_at(NodeKind::OutputLed, false, 500.0, 100.0);
        c.wire(a, x1, 0);
        c.wire(b, x1, 1);
        c.wire(x1, x2, 0);
        c.wire(cin, x2, 1);
        c.wire(a, a1, 0);
        c.wire(b, a1, 1);
        c.wire(x1, a2, 0);
        c.wire(cin, a2, 1);
        c.wire(a1, or, 0);
        c.wire(a2, or, 1);
        c.wire(x2, sum, 0);
        c.wire(or, cout, 0);

        let table = truth_table(&c.circuit).unwrap();
        assert_eq!(table.rows.len(), 8);
        for (i, row) in table.rows.iter().enumerate() {
            let total = (i & 1) + ((i >> 1) & 1) + ((i >> 2) & 1);
            assert_eq!(row.outputs, vec![total & 1 == 1, total >= 2], "row {}", i);
        }
    }

    #[test]
    fn xor_built_from_nands_matches_xor() {
        let mut c = Builder::new();
        let a = c.node_at(NodeKind::InputSwitch, false, 0.0, 0.0);
        let b = c.node_at(NodeKind::InputSwitch, false, 0.0, 100.0);
        let n1 = c.node(NodeKind::Nand, false);
        let n2 = c.node(NodeKind::Nand, false);
        let n3 = c.node(NodeKind::Nand, false);
        let n4 = c.node(NodeKind::Nand, false);
        let led = c.node_at(NodeKind::OutputLed, false, 400.0, 0.0);
        c.wire(a, n1, 0);
        c.wire(b, n1, 1);
        c.wire(a, n2, 0);
        c.wire(n1, n2, 1);
        c.wire(n1, n3, 0);
        c.wire(b, n3, 1);
        c.wire(n2, n4, 0);
        c.wire(n3, n4, 1);
        c.wire(n4, led, 0);

        let table = truth_table(&c.circuit).unwrap();
        for (i, row) in table.rows.iter().enumerate() {
            let a = i & 2 != 0;
            let b = i & 1 != 0;
            assert_eq!(row.outputs, vec![a ^ b]);
        }
    }

    #[test]
    fn truth_table_orders_ports_top_to_bottom() {
        let mut c = Builder::new();
        let low = c.node_at(NodeKind::InputSwitch, false, 0.0, 200.0);
        let high = c.node_at(NodeKind::InputSwitch, false, 0.0, 0.0);
        let led = c.node(NodeKind::OutputLed, false);
        c.wire(low, led, 0);
        let table = truth_table(&c.circuit).unwrap();
        assert_eq!(table.inputs[0].id, high);
        assert_eq!(table.inputs[1].id, low);
        assert_eq!(table.rows[1].inputs, vec![false, true]);
        assert_eq!(table.rows[1].outputs, vec![true]);
        assert_eq!(table.rows[2].outputs, vec![false]);
    }

    #[test]
    fn truth_table_requires_outputs_and_limits_inputs() {
        let mut c = Builder::new();
        c.node(NodeKind::InputSwitch, false);
        assert!(truth_table(&c.circuit).is_err());

        let mut wide = Builder::new();
        for _ in 0..(MAX_TABLE_INPUTS + 1) {
            wide.node(NodeKind::InputSwitch, false);
        }
        wide.node(NodeKind::OutputLed, false);
        assert!(truth_table(&wide.circuit).is_err());
    }

    fn sr_latch() -> (Circuit, u32, u32, u32, u32) {
        let mut c = Builder::new();
        let r = c.node(NodeKind::InputSwitch, false);
        let s = c.node(NodeKind::InputSwitch, false);
        let nor_q = c.node(NodeKind::Nor, false);
        let nor_qn = c.node(NodeKind::Nor, false);
        c.wire(r, nor_q, 0);
        c.wire(nor_qn, nor_q, 1);
        c.wire(nor_q, nor_qn, 0);
        c.wire(s, nor_qn, 1);
        (c.circuit, r, s, nor_q, nor_qn)
    }

    fn step(
        circuit: &mut Circuit,
        previous: &HashMap<u32, bool>,
        set: &[(u32, bool)],
    ) -> SimResult {
        for (id, value) in set {
            for node in &mut circuit.nodes {
                if node.id == *id {
                    node.value = *value;
                }
            }
        }
        simulate(circuit, Some(previous)).unwrap()
    }

    #[test]
    fn sr_latch_holds_state() {
        let (mut circuit, r, s, q, qn) = sr_latch();
        let initial = simulate(&circuit, None).unwrap();
        assert!(initial.has_cycle);
        assert!(initial.stable);
        assert_ne!(initial.node_states[&q], initial.node_states[&qn]);

        let set = step(&mut circuit, &initial.node_states, &[(s, true)]);
        assert!(set.stable);
        assert!(set.node_states[&q]);
        assert!(!set.node_states[&qn]);

        let hold_one = step(&mut circuit, &set.node_states, &[(s, false)]);
        assert!(hold_one.stable);
        assert!(hold_one.node_states[&q]);
        assert!(!hold_one.node_states[&qn]);

        let reset = step(&mut circuit, &hold_one.node_states, &[(r, true)]);
        assert!(reset.stable);
        assert!(!reset.node_states[&q]);
        assert!(reset.node_states[&qn]);

        let hold_zero = step(&mut circuit, &reset.node_states, &[(r, false)]);
        assert!(hold_zero.stable);
        assert!(!hold_zero.node_states[&q]);
        assert!(hold_zero.node_states[&qn]);
    }

    #[test]
    fn sr_latch_truth_table_flags_feedback() {
        let (mut circuit, _, _, q, _) = sr_latch();
        let mut b = Builder::new();
        b.circuit = circuit.clone();
        b.next_node = 10;
        let led = b.node_at(NodeKind::OutputLed, false, 500.0, 0.0);
        b.wire(q, led, 0);
        circuit = b.circuit;
        let table = truth_table(&circuit).unwrap();
        assert!(table.has_cycle);
        assert_eq!(table.rows.len(), 4);
        assert!(table.rows.iter().all(|r| r.stable));
    }

    #[test]
    fn ring_oscillator_is_detected() {
        let mut c = Builder::new();
        let not = c.node(NodeKind::Not, false);
        let led = c.node(NodeKind::OutputLed, false);
        c.wire(not, not, 0);
        c.wire(not, led, 0);
        let result = simulate(&c.circuit, None).unwrap();
        assert!(result.has_cycle);
        assert!(result.oscillating);
        assert!(!result.stable);
        assert!(result.sweeps <= MAX_SWEEPS);
    }

    #[test]
    fn three_inverter_ring_is_detected() {
        let mut c = Builder::new();
        let n1 = c.node(NodeKind::Not, false);
        let n2 = c.node(NodeKind::Not, false);
        let n3 = c.node(NodeKind::Not, false);
        c.wire(n1, n2, 0);
        c.wire(n2, n3, 0);
        c.wire(n3, n1, 0);
        let result = simulate(&c.circuit, None).unwrap();
        assert!(result.has_cycle);
        assert!(result.oscillating);
    }

    #[test]
    fn simulate_rejects_invalid_circuits() {
        let mut c = Builder::new();
        let sw = c.node(NodeKind::InputSwitch, false);
        let not = c.node(NodeKind::Not, false);
        c.wire(sw, not, 3);
        assert!(simulate(&c.circuit, None).is_err());
        assert!(truth_table(&c.circuit).is_err());
    }

    #[test]
    fn empty_circuit_simulates() {
        let result = simulate(&Circuit::default(), None).unwrap();
        assert!(result.stable);
        assert!(result.node_states.is_empty());
    }

    #[test]
    fn previous_state_is_ignored_for_unknown_nodes() {
        let (circuit, _, _, _, _) = sr_latch();
        let mut previous = HashMap::new();
        previous.insert(999, true);
        let result = simulate(&circuit, Some(&previous)).unwrap();
        assert!(result.stable);
    }
}
