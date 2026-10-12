use std::collections::{HashMap, HashSet};
use std::fmt;

use serde::{Deserialize, Serialize};

pub const MAX_NODES: usize = 2000;
pub const MAX_WIRES: usize = 6000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum NodeKind {
    InputSwitch,
    Clock,
    And,
    Or,
    Not,
    Nand,
    Nor,
    Xor,
    Xnor,
    OutputLed,
    Probe,
}

impl NodeKind {
    pub fn input_count(self) -> usize {
        match self {
            NodeKind::InputSwitch | NodeKind::Clock => 0,
            NodeKind::Not | NodeKind::OutputLed | NodeKind::Probe => 1,
            NodeKind::And
            | NodeKind::Or
            | NodeKind::Nand
            | NodeKind::Nor
            | NodeKind::Xor
            | NodeKind::Xnor => 2,
        }
    }

    pub fn output_count(self) -> usize {
        match self {
            NodeKind::OutputLed | NodeKind::Probe => 0,
            _ => 1,
        }
    }

    pub fn is_source(self) -> bool {
        matches!(self, NodeKind::InputSwitch | NodeKind::Clock)
    }

    pub fn is_sink(self) -> bool {
        matches!(self, NodeKind::OutputLed | NodeKind::Probe)
    }

    pub fn short_name(self) -> &'static str {
        match self {
            NodeKind::InputSwitch => "SW",
            NodeKind::Clock => "CLK",
            NodeKind::And => "AND",
            NodeKind::Or => "OR",
            NodeKind::Not => "NOT",
            NodeKind::Nand => "NAND",
            NodeKind::Nor => "NOR",
            NodeKind::Xor => "XOR",
            NodeKind::Xnor => "XNOR",
            NodeKind::OutputLed => "LED",
            NodeKind::Probe => "PROBE",
        }
    }

    pub fn evaluate(self, inputs: &[bool]) -> bool {
        let a = inputs.first().copied().unwrap_or(false);
        let b = inputs.get(1).copied().unwrap_or(false);
        match self {
            NodeKind::And => a && b,
            NodeKind::Or => a || b,
            NodeKind::Not => !a,
            NodeKind::Nand => !(a && b),
            NodeKind::Nor => !(a || b),
            NodeKind::Xor => a ^ b,
            NodeKind::Xnor => !(a ^ b),
            NodeKind::OutputLed | NodeKind::Probe => a,
            NodeKind::InputSwitch | NodeKind::Clock => false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: u32,
    pub kind: NodeKind,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default)]
    pub value: bool,
    #[serde(default)]
    pub label: Option<String>,
}

impl Node {
    pub fn display_label(&self) -> String {
        match &self.label {
            Some(label) if !label.trim().is_empty() => label.clone(),
            _ => format!("{}{}", self.kind.short_name(), self.id),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Wire {
    #[serde(default)]
    pub id: u32,
    pub from: u32,
    #[serde(default)]
    pub from_pin: usize,
    pub to: u32,
    pub to_pin: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Circuit {
    #[serde(default)]
    pub nodes: Vec<Node>,
    #[serde(default)]
    pub wires: Vec<Wire>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CircuitError(pub String);

impl fmt::Display for CircuitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for CircuitError {}

impl Circuit {
    #[allow(dead_code)]
    pub const SCHEMA_SIG: &'static str = "anshumanj28-bitflow-schema";

    pub fn validate(&self) -> Result<(), CircuitError> {
        if self.nodes.len() > MAX_NODES {
            return Err(CircuitError(format!("too many nodes (max {})", MAX_NODES)));
        }
        if self.wires.len() > MAX_WIRES {
            return Err(CircuitError(format!("too many wires (max {})", MAX_WIRES)));
        }

        let mut kinds: HashMap<u32, NodeKind> = HashMap::with_capacity(self.nodes.len());
        for node in &self.nodes {
            if kinds.insert(node.id, node.kind).is_some() {
                return Err(CircuitError(format!("duplicate node id {}", node.id)));
            }
        }

        let mut driven: HashSet<(u32, usize)> = HashSet::new();
        for wire in &self.wires {
            let from_kind = kinds.get(&wire.from).ok_or_else(|| {
                CircuitError(format!("wire references unknown node {}", wire.from))
            })?;
            let to_kind = kinds.get(&wire.to).ok_or_else(|| {
                CircuitError(format!("wire references unknown node {}", wire.to))
            })?;
            if wire.from_pin >= from_kind.output_count() {
                return Err(CircuitError(format!(
                    "node {} has no output pin {}",
                    wire.from, wire.from_pin
                )));
            }
            if wire.to_pin >= to_kind.input_count() {
                return Err(CircuitError(format!(
                    "node {} has no input pin {}",
                    wire.to, wire.to_pin
                )));
            }
            if !driven.insert((wire.to, wire.to_pin)) {
                return Err(CircuitError(format!(
                    "input pin {} of node {} is driven by more than one wire",
                    wire.to_pin, wire.to
                )));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: u32, kind: NodeKind) -> Node {
        Node {
            id,
            kind,
            x: 0.0,
            y: 0.0,
            value: false,
            label: None,
        }
    }

    fn wire(from: u32, to: u32, to_pin: usize) -> Wire {
        Wire {
            id: 0,
            from,
            from_pin: 0,
            to,
            to_pin,
        }
    }

    #[test]
    fn node_kind_serializes_as_screaming_snake_case() {
        let json = serde_json::to_string(&NodeKind::InputSwitch).unwrap();
        assert_eq!(json, "\"INPUT_SWITCH\"");
        let kind: NodeKind = serde_json::from_str("\"OUTPUT_LED\"").unwrap();
        assert_eq!(kind, NodeKind::OutputLed);
    }

    #[test]
    fn circuit_deserializes_with_defaults() {
        let circuit: Circuit = serde_json::from_str(
            r#"{"nodes":[{"id":1,"kind":"AND"},{"id":2,"kind":"CLOCK","x":4.5,"y":2,"value":true,"label":"C"}],"wires":[]}"#,
        )
        .unwrap();
        assert_eq!(circuit.nodes.len(), 2);
        assert!(!circuit.nodes[0].value);
        assert!(circuit.nodes[1].value);
        assert_eq!(circuit.nodes[1].display_label(), "C");
        assert_eq!(circuit.nodes[0].display_label(), "AND1");
    }

    #[test]
    fn pin_counts_match_kinds() {
        assert_eq!(NodeKind::Not.input_count(), 1);
        assert_eq!(NodeKind::Xnor.input_count(), 2);
        assert_eq!(NodeKind::InputSwitch.input_count(), 0);
        assert_eq!(NodeKind::OutputLed.output_count(), 0);
        assert_eq!(NodeKind::And.output_count(), 1);
        assert!(NodeKind::Clock.is_source());
        assert!(NodeKind::Probe.is_sink());
        assert!(!NodeKind::And.is_source());
    }

    #[test]
    fn gate_evaluation_matches_definitions() {
        let cases = [(false, false), (false, true), (true, false), (true, true)];
        for (a, b) in cases {
            let i = [a, b];
            assert_eq!(NodeKind::And.evaluate(&i), a && b);
            assert_eq!(NodeKind::Or.evaluate(&i), a || b);
            assert_eq!(NodeKind::Nand.evaluate(&i), !(a && b));
            assert_eq!(NodeKind::Nor.evaluate(&i), !(a || b));
            assert_eq!(NodeKind::Xor.evaluate(&i), a != b);
            assert_eq!(NodeKind::Xnor.evaluate(&i), a == b);
            assert_eq!(NodeKind::Not.evaluate(&[a]), !a);
            assert_eq!(NodeKind::Probe.evaluate(&[a]), a);
            assert_eq!(NodeKind::OutputLed.evaluate(&[b]), b);
        }
    }

    #[test]
    fn validation_rejects_bad_circuits() {
        let duplicate = Circuit {
            nodes: vec![node(1, NodeKind::And), node(1, NodeKind::Or)],
            wires: vec![],
        };
        assert!(duplicate.validate().is_err());

        let unknown = Circuit {
            nodes: vec![node(1, NodeKind::InputSwitch)],
            wires: vec![wire(1, 9, 0)],
        };
        assert!(unknown.validate().is_err());

        let bad_pin = Circuit {
            nodes: vec![node(1, NodeKind::InputSwitch), node(2, NodeKind::Not)],
            wires: vec![wire(1, 2, 1)],
        };
        assert!(bad_pin.validate().is_err());

        let from_sink = Circuit {
            nodes: vec![node(1, NodeKind::OutputLed), node(2, NodeKind::Not)],
            wires: vec![wire(1, 2, 0)],
        };
        assert!(from_sink.validate().is_err());

        let double_driven = Circuit {
            nodes: vec![
                node(1, NodeKind::InputSwitch),
                node(2, NodeKind::InputSwitch),
                node(3, NodeKind::Not),
            ],
            wires: vec![wire(1, 3, 0), wire(2, 3, 0)],
        };
        assert!(double_driven.validate().is_err());

        let good = Circuit {
            nodes: vec![node(1, NodeKind::InputSwitch), node(2, NodeKind::Not)],
            wires: vec![wire(1, 2, 0)],
        };
        assert!(good.validate().is_ok());
    }
}
