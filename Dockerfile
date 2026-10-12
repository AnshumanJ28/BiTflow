# ==========================================
# Build stage
# ==========================================
FROM rust:1.80-slim as builder

WORKDIR /usr/src/app

# Copy dependency manifests
COPY Cargo.toml Cargo.lock ./

# Cache dependencies build
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release
RUN rm -rf src

# Copy actual source code
COPY src ./src
RUN touch src/main.rs
RUN cargo build --release

# ==========================================
# Runtime stage
# ==========================================
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy compiled binary
COPY --from=builder /usr/src/app/target/release/logic-gate-sim /app/bitflow

# Copy static frontend assets
COPY static ./static

# Configure environment variables for Render
ENV HOST=0.0.0.0
ENV PORT=10000
ENV STATIC_DIR=static
ENV DATA_DIR=/app/data

EXPOSE 10000

CMD ["/app/bitflow"]
