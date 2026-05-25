//! Encrypted File Storage for Session Data
//!
//! Replaces OS keyring with argon2 + AES-256-GCM encrypted file storage.
//! The encrypted session file is stored in the Tauri app data directory.
//!
//! # Encryption
//!
//! - Key derivation: argon2id from hostname + username
//! - Encryption: AES-256-GCM with random nonce per write
//! - File format: [nonce: 12 bytes][ciphertext + GCM tag]
//! - File permissions: 0o600 on Unix

use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::Aes256Gcm;
use aes_gcm::Nonce;
use argon2::{Algorithm, Argon2, Params, Version};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::models::qr_login::Session;

const SESSION_FILE: &str = ".session.enc";
const NONCE_SIZE: usize = 12;

/// Alias for results returned by secure storage operations.
pub type Result<T> = std::result::Result<T, String>;

/// Trait for secure session storage operations.
pub trait SecureStorage: Send + Sync {
    fn save(&self, app: &AppHandle, session: &Session) -> Result<()>;
    fn load(&self, app: &AppHandle) -> Result<Option<Session>>;
    fn delete(&self, app: &AppHandle) -> Result<()>;
}

/// AES-256-GCM encrypted file storage.
///
/// Uses argon2id for key derivation and AES-256-GCM for authenticated
/// encryption. Each write generates a fresh random nonce to ensure
/// semantic security across successive saves.
pub struct EncryptedFileStorage;

impl EncryptedFileStorage {
    /// Creates a new `EncryptedFileStorage` instance.
    ///
    /// This is a zero-sized type, so construction is effectively free.
    pub const fn new() -> Self {
        Self
    }
}

impl Default for EncryptedFileStorage {
    fn default() -> Self {
        Self::new()
    }
}

impl SecureStorage for EncryptedFileStorage {
    fn save(&self, app: &AppHandle, session: &Session) -> Result<()> {
        let json = serde_json::to_vec(session)
            .map_err(|e| format!("Failed to serialize session: {}", e))?;

        let key = derive_key()?;
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|e| format!("Failed to create cipher: {}", e))?;

        let ciphertext = cipher
            .encrypt(&nonce, json.as_ref())
            .map_err(|e| format!("Encryption failed: {}", e))?;

        let mut blob = Vec::with_capacity(NONCE_SIZE + ciphertext.len());
        blob.extend_from_slice(&nonce);
        blob.extend_from_slice(&ciphertext);

        let path = session_file_path(app);
        fs::write(&path, &blob).map_err(|e| format!("Failed to write session file: {}", e))?;

        set_file_permissions(&path);

        log::info!("[BE] secure_storage::save: wrote {} bytes", blob.len());
        Ok(())
    }

    fn load(&self, app: &AppHandle) -> Result<Option<Session>> {
        let path = session_file_path(app);
        if !path.exists() {
            return Ok(None);
        }

        let blob = fs::read(&path).map_err(|e| format!("Failed to read session file: {}", e))?;

        if blob.len() <= NONCE_SIZE {
            log::warn!("[BE] secure_storage::load: file too short, treating as empty");
            return Ok(None);
        }

        let (nonce_bytes, ciphertext) = blob.split_at(NONCE_SIZE);
        let nonce = Nonce::from_slice(nonce_bytes);

        let key = derive_key()?;
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|e| format!("Failed to create cipher: {}", e))?;

        let plaintext = match cipher.decrypt(nonce, ciphertext) {
            Ok(p) => p,
            Err(e) => {
                log::warn!(
                    "[BE] secure_storage::load: decryption failed ({}), \
                     treating as no session",
                    e
                );
                return Ok(None);
            }
        };

        let session: Session = serde_json::from_slice(&plaintext)
            .map_err(|e| format!("Failed to deserialize session: {}", e))?;

        log::info!("[BE] secure_storage::load: session loaded successfully");
        Ok(Some(session))
    }

    fn delete(&self, app: &AppHandle) -> Result<()> {
        let path = session_file_path(app);
        if path.exists() {
            fs::remove_file(&path).map_err(|e| format!("Failed to delete session file: {}", e))?;
            log::info!("[BE] secure_storage::delete: session file deleted");
        } else {
            log::info!("[BE] secure_storage::delete: no session file to delete");
        }
        Ok(())
    }
}

/// Derives a 256-bit encryption key using argon2id.
///
/// The key material is derived from:
/// - **Password**: `"bilibili-dl-session:{USER}"` (or `USERNAME` on Windows)
/// - **Salt**: `"bilibili-dl:{hostname}:{user}"`
///
/// Argon2 parameters: 64 MiB memory, 3 iterations, 4 parallelism.
///
/// # Errors
///
/// Returns an error if the hostname cannot be resolved or argon2
/// parameter construction / hashing fails.
fn derive_key() -> Result<[u8; 32]> {
    let host = hostname::get()
        .map_err(|e| format!("Failed to get hostname: {}", e))?
        .to_string_lossy()
        .to_string();

    let user = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "unknown".to_string());

    let password = format!("bilibili-dl-session:{}", user);
    let salt_input = format!("bilibili-dl:{}:{}", host, user);

    let params = Params::new(64 * 1024, 3, 4, Some(32))
        .map_err(|e| format!("Failed to create argon2 params: {}", e))?;

    let hasher = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut key = [0u8; 32];
    hasher
        .hash_password_into(password.as_bytes(), salt_input.as_bytes(), &mut key)
        .map_err(|e| format!("Key derivation failed: {}", e))?;

    Ok(key)
}

/// Returns the path to the encrypted session file in the app data directory.
///
/// Falls back to the current directory if the app data directory is
/// unavailable.
fn session_file_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(SESSION_FILE)
}

/// Restricts the session file to owner-read/write only (0o600) on Unix.
///
/// Failures are logged as warnings but do not propagate, since overly
/// permissive file modes are a security concern but not a functional error.
#[cfg(unix)]
fn set_file_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Err(e) = fs::set_permissions(path, fs::Permissions::from_mode(0o600)) {
        log::warn!("[BE] secure_storage: failed to set file permissions: {}", e);
    }
}

/// No-op on non-Unix platforms.
///
/// Windows uses ACLs; the file inherits the user's permissions by default.
#[cfg(not(unix))]
fn set_file_permissions(_path: &Path) {}
