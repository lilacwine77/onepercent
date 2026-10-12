# Same base as the existing verified-build CI; never substitute a mutable tag.
FROM solanafoundation/solana-verifiable-build@sha256:12fd4c0a0790f0fc41ef74b0cdb6bccc167ba6137eb1adb749bac649481c86bd
RUN rustup toolchain install 1.95.0 --profile minimal \
    && rustup default 1.95.0 \
    && rustc --version | grep '^rustc 1.95.0 ' \
    && cargo build-sbf --version | grep '^cargo-build-sbf 4.3.0$' \
    && cargo build-sbf --install-only --tools-version v1.57
ENV RUST_VERSION=1.95.0
ENV CARGO_INCREMENTAL=0
