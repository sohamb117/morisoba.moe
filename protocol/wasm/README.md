# Browser crypto bindings

Thin wasm-bindgen bindings to pinned RustCrypto `aes-gcm` 0.10.3 and `argon2` 0.5.3. No cryptographic primitive is implemented here. Cargo.lock pins transitive dependencies. This adapter itself has not undergone an independent security audit.

The browser worker requires WASM and fails closed if it cannot load. AES-256-GCM retains the existing 12-byte nonce, 16-byte appended tag and canonical JSON associated data. Argon2id retains version 19, 64 MiB, three passes, four lanes and a 32-byte result. There is no ciphertext or vault migration. The ratchet SDK remains pinned and runs in the same worker; its internal primitives are not replaced by these bindings. Native WebCrypto remains used for signatures and hashing, and by the server-side password-change path.

Build (Rust 1.99.0, wasm-pack 0.15.0):

```sh
rustup target add wasm32-unknown-unknown
wasm-pack build protocol/wasm --target web --out-dir ../../mimori/crypto --out-name mimori_crypto --release
npm run build:protocol
```

Commit the generated `mimori/crypto/mimori_crypto.js` and `mimori_crypto_bg.wasm` with source changes. wasm-pack overwrites the output .gitignore; retain the repository's ignore rules for package.json and declarations. CI uses these checked-in artifacts without requiring Rust. Run `node --test tests/protocol-wasm.test.mjs` to verify native/WASM ciphertext and legacy-vault compatibility.

Client crypto runs in a dedicated module worker. RPC commands are serialized to protect ratchet state. Closing the client terminates the worker. Archive writes use bounded concurrency and revision checks, and sync reads use an additive change log (migration 0004). Older archive routes remain available.

Local Node 22 benchmark, same password/salt and unchanged Argon2 parameters: JavaScript 2643 ms, WASM 206 ms, equal derived keys. This measures password derivation only, not end-to-end login or AES throughput. Main-thread bundle shrank from approximately 2.08 MB to 16 KB; the SDK is loaded in the worker instead.

Upstream documentation and licenses:
- https://docs.rs/aes-gcm/0.10.3/aes_gcm/ (MIT OR Apache-2.0)
- https://docs.rs/argon2/0.5.3/argon2/ (MIT OR Apache-2.0)
- https://github.com/wasm-bindgen/wasm-bindgen (MIT OR Apache-2.0)
- https://github.com/RustCrypto/utils/tree/master/zeroize (MIT OR Apache-2.0)
