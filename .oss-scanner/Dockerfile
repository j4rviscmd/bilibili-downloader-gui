# Build environment for Anthropic's oss-scanner (red.anthropic.com/oss-scanner).
# CONSTRAINT: the scanner builds this image with network access, then audits
# the project offline — every dependency (apt, npm, crates) must be fetched
# by these RUN layers.
# Why this dep list: mirrors .github/workflows/ci.yml rust jobs (ubuntu-latest,
# Node 20, Rust stable, same Tauri apt packages) so the audited build matches
# what CI validates.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    RUSTFLAGS="-C force-frame-pointers=yes"

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        curl \
        git \
        pkg-config \
        libssl-dev \
        libwebkit2gtk-4.1-dev \
        libappindicator3-dev \
        librsvg2-dev \
        patchelf \
        libdbus-1-dev \
        libglib2.0-dev \
    && rm -rf /var/lib/apt/lists/*

# Node 20 (package.json engines: node >=20, npm >=10)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Rust stable
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --default-toolchain stable --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"

# scanner contract: the checkout lives inside the image, at /src
COPY . /src
WORKDIR /src

# Frontend: install deps, type-check, bundle
RUN npm ci
RUN npm run build

# Rust backend: compile with debug info (debug profile default)
WORKDIR /src/src-tauri
RUN cargo build

# Tests: run for signal, but a failure must not abort the audit build
# (oss-scanner template convention)
RUN cargo test || echo "WARNING: cargo test reported failures"
WORKDIR /src
# `npm test` is vitest watch mode; run-once here
RUN npx vitest run || echo "WARNING: vitest reported failures"
