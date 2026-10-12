mod api;
mod circuit;
mod simulator;

use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;

#[tokio::main]
async fn main() {
    let host: IpAddr = std::env::var("HOST")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or_else(|| IpAddr::from([0, 0, 0, 0]));
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(3000);
    let static_dir = PathBuf::from(std::env::var("STATIC_DIR").unwrap_or_else(|_| "static".into()));
    let data_dir = PathBuf::from(std::env::var("DATA_DIR").unwrap_or_else(|_| "data".into()));

    if let Err(error) = tokio::fs::create_dir_all(&data_dir).await {
        eprintln!("cannot create data directory {}: {}", data_dir.display(), error);
        std::process::exit(1);
    }

    let app = api::router(api::AppState::new(data_dir), static_dir);
    let addr = SocketAddr::new(host, port);

    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("cannot bind {}: {}", addr, error);
            std::process::exit(1);
        }
    };

    println!("BiTflow Logic Gate Simulator running at http://{}", addr);

    if let Err(error) = axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
    {
        eprintln!("server error: {}", error);
        std::process::exit(1);
    }
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}
