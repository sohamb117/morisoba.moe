use aes_gcm::{aead::{Aead, KeyInit, Payload}, Aes256Gcm, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use wasm_bindgen::prelude::*;
use zeroize::Zeroizing;

// Thin bindings only; all cryptographic primitives are provided by RustCrypto.
#[wasm_bindgen]
pub fn derive_password(password: Vec<u8>, salt: &[u8]) -> Result<Vec<u8>, JsError> {
    let password = Zeroizing::new(password);
    if salt.len() != 16 || password.len() > 4096 { return Err(JsError::new("Invalid password parameters")); }
    let params = Params::new(65536, 3, 4, Some(32)).map_err(|_| JsError::new("Invalid KDF parameters"))?;
    let mut output = vec![0u8; 32];
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(&password, salt, &mut output).map_err(|_| JsError::new("Password derivation failed"))?;
    Ok(output)
}

#[wasm_bindgen]
pub fn encrypt(key: Vec<u8>, nonce: &[u8], plaintext: Vec<u8>, aad: &[u8]) -> Result<Vec<u8>, JsError> {
    let key = Zeroizing::new(key);
    let plaintext = Zeroizing::new(plaintext);
    if key.len() != 32 || nonce.len() != 12 { return Err(JsError::new("Invalid encryption parameters")); }
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| JsError::new("Invalid key"))?;
    cipher.encrypt(Nonce::from_slice(nonce), Payload { msg: &plaintext, aad })
        .map_err(|_| JsError::new("Encryption failed"))
}

#[wasm_bindgen]
pub fn decrypt(key: Vec<u8>, nonce: &[u8], ciphertext: &[u8], aad: &[u8]) -> Result<Vec<u8>, JsError> {
    let key = Zeroizing::new(key);
    if key.len() != 32 || nonce.len() != 12 { return Err(JsError::new("Invalid decryption parameters")); }
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| JsError::new("Invalid key"))?;
    cipher.decrypt(Nonce::from_slice(nonce), Payload { msg: ciphertext, aad })
        .map_err(|_| JsError::new("Ciphertext authentication failed"))
}
