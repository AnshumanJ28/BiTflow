use std::collections::HashMap;
use std::io::ErrorKind;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use tower_http::services::ServeDir;

use crate::circuit::{Circuit, CircuitError};
use crate::simulator::{self, SimResult, TruthTable};

#[derive(Clone)]
pub struct AppState {
    dir: Arc<PathBuf>,
    counter: Arc<AtomicU64>,
}

impl AppState {
    pub fn new(dir: PathBuf) -> Self {
        AppState {
            dir: Arc::new(dir),
            counter: Arc::new(AtomicU64::new(0)),
        }
    }

    fn next_id(&self) -> String {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let count = self.counter.fetch_add(1, Ordering::Relaxed) & 0xffff;
        format!("{:x}{:04x}", millis, count)
    }

    fn path_for(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{}.json", id))
    }
}

pub struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        ApiError {
            status,
            message: message.into(),
        }
    }

    fn internal(error: impl std::fmt::Display) -> Self {
        ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
    }
}

impl From<CircuitError> for ApiError {
    fn from(error: CircuitError) -> Self {
        ApiError::new(StatusCode::BAD_REQUEST, error.to_string())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}

#[derive(Deserialize)]
struct SimulateRequest {
    circuit: Circuit,
    #[serde(default)]
    previous: Option<HashMap<u32, bool>>,
}

async fn simulate(Json(request): Json<SimulateRequest>) -> Result<Json<SimResult>, ApiError> {
    let result = simulator::simulate(&request.circuit, request.previous.as_ref())?;
    Ok(Json(result))
}

async fn truth_table(Json(circuit): Json<Circuit>) -> Result<Json<TruthTable>, ApiError> {
    let table = tokio::task::spawn_blocking(move || simulator::truth_table(&circuit))
        .await
        .map_err(ApiError::internal)??;
    Ok(Json(table))
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 32 && id.chars().all(|c| c.is_ascii_hexdigit())
}

async fn save_circuit(
    State(state): State<AppState>,
    Json(circuit): Json<Circuit>,
) -> Result<Json<Value>, ApiError> {
    circuit.validate()?;
    let id = state.next_id();
    let body = serde_json::to_vec_pretty(&circuit).map_err(ApiError::internal)?;
    tokio::fs::write(state.path_for(&id), body)
        .await
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "id": id })))
}

async fn load_circuit(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Circuit>, ApiError> {
    if !valid_id(&id) {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "invalid circuit id"));
    }
    match tokio::fs::read(state.path_for(&id)).await {
        Ok(bytes) => serde_json::from_slice::<Circuit>(&bytes)
            .map(Json)
            .map_err(ApiError::internal),
        Err(error) if error.kind() == ErrorKind::NotFound => {
            Err(ApiError::new(StatusCode::NOT_FOUND, "circuit not found"))
        }
        Err(error) => Err(ApiError::internal(error)),
    }
}

pub fn router(state: AppState, static_dir: PathBuf) -> Router {
    Router::new()
        .route("/api/simulate", post(simulate))
        .route("/api/truth-table", post(truth_table))
        .route("/api/circuit/save", post(save_circuit))
        .route("/api/circuit/:id", get(load_circuit))
        .fallback_service(ServeDir::new(static_dir).append_index_html_on_directories(true))
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn circuit_ids_are_validated() {
        assert!(valid_id("19a3f0b2c4d10000"));
        assert!(!valid_id(""));
        assert!(!valid_id("../etc/passwd"));
        assert!(!valid_id("abc/def"));
        assert!(!valid_id("xyz"));
        assert!(!valid_id(&"a".repeat(33)));
    }

    #[test]
    fn generated_ids_are_unique_and_valid() {
        let state = AppState::new(PathBuf::from("data"));
        let a = state.next_id();
        let b = state.next_id();
        assert_ne!(a, b);
        assert!(valid_id(&a));
        assert!(valid_id(&b));
    }
}
