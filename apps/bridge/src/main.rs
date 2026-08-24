use std::{collections::HashMap, fs, net::SocketAddr, path::Path, sync::Arc, time::Duration};

use axum::{
    Json, Router,
    body::Body,
    extract::State,
    http::{HeaderValue, Request, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::Utc;
use russh::{
    ChannelMsg, client,
    keys::{
        self, PublicKeyOrCertificate,
        agent::{self, client::AgentClient},
        key::PrivateKeyWithHashAlg,
    },
};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::{
    net::TcpListener,
    sync::{Mutex, RwLock, watch},
};

const DEFAULT_PORT: u16 = 4319;
const DEFAULT_ORIGINS: &str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4318,http://127.0.0.1:4318,https://tyyun.haibao.fun";

#[derive(Clone)]
struct AppState {
    allowed_origins: Arc<Vec<String>>,
    servers: Arc<RwLock<HashMap<String, ServerRecord>>>,
    pending_keys: Arc<Mutex<HashMap<String, String>>>,
    tunnels: Arc<Mutex<HashMap<String, Tunnel>>>,
    snapshots: Arc<Mutex<HashMap<String, RuntimeSnapshot>>>,
}

struct Tunnel {
    stop: watch::Sender<bool>,
    task: tokio::task::JoinHandle<()>,
}

#[derive(Debug, Error)]
enum BridgeError {
    #[error("{message}")]
    Api {
        code: String,
        message: String,
        details: Option<serde_json::Value>,
    },
    #[error("{0}")]
    Internal(String),
}

impl BridgeError {
    fn api(code: &str, message: impl Into<String>) -> Self {
        Self::Api {
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }

    fn with_details(code: &str, message: impl Into<String>, details: serde_json::Value) -> Self {
        Self::Api {
            code: code.into(),
            message: message.into(),
            details: Some(details),
        }
    }

    fn code(&self) -> &str {
        match self {
            Self::Api { code, .. } => code,
            Self::Internal(_) => "INTERNAL_ERROR",
        }
    }

    fn message(&self) -> String {
        self.to_string()
    }
}

impl IntoResponse for BridgeError {
    fn into_response(self) -> Response {
        let status = match self.code() {
            "FORBIDDEN" => StatusCode::FORBIDDEN,
            "NOT_FOUND" => StatusCode::NOT_FOUND,
            "RESOURCE_BUSY" | "LOCAL_PORT_IN_USE" => StatusCode::CONFLICT,
            "INTERNAL_ERROR" => StatusCode::INTERNAL_SERVER_ERROR,
            _ => StatusCode::BAD_REQUEST,
        };
        let body = match self {
            Self::Api {
                code,
                message,
                details,
            } => ApiError {
                error: ApiErrorValue {
                    code,
                    message,
                    details,
                },
            },
            Self::Internal(message) => ApiError {
                error: ApiErrorValue {
                    code: "INTERNAL_ERROR".into(),
                    message,
                    details: None,
                },
            },
        };
        (status, Json(body)).into_response()
    }
}

#[derive(Serialize)]
struct ApiError {
    error: ApiErrorValue,
}

#[derive(Serialize)]
struct ApiErrorValue {
    code: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerRecord {
    id: String,
    name: String,
    source: String,
    #[serde(default)]
    config_alias: Option<String>,
    host: String,
    port: u16,
    username: String,
    auth_type: String,
    #[serde(default)]
    private_key_path: Option<String>,
    #[serde(default)]
    host_fingerprint: Option<String>,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    credential_id: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppRecord {
    id: String,
    server_id: String,
    name: String,
    #[serde(rename = "type")]
    app_type: String,
    remote_host: String,
    remote_port: u16,
    local_port: u16,
    protocol: String,
    health_path: String,
    auto_start: bool,
    #[serde(default)]
    working_directory: Option<String>,
    #[serde(default)]
    start_command: Option<String>,
    stop_on_disconnect: bool,
    #[serde(default)]
    stop_command: Option<String>,
    icon_kind: String,
    icon_value: String,
    start_timeout_ms: u64,
    health_timeout_ms: u64,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Credential {
    kind: String,
    value: String,
}

#[derive(Debug, Deserialize)]
struct ConnectRequest {
    app: AppRecord,
    server: ServerRecord,
    #[serde(default)]
    credential: Option<Credential>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSnapshot {
    app_id: String,
    status: String,
    started_by_launchpad: bool,
    updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_message: Option<String>,
}

#[derive(Serialize)]
struct ConnectResponse {
    url: String,
    status: &'static str,
}

#[derive(Serialize)]
struct HealthResponse {
    ok: bool,
    mode: &'static str,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct BridgeFileConfig {
    control_origin: Option<String>,
    local_port: Option<u16>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let file_config = load_file_config();
    let origins = std::env::var("CONTROL_ORIGIN")
        .ok()
        .or(file_config.control_origin)
        .unwrap_or_else(|| DEFAULT_ORIGINS.into())
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let port = std::env::var("LOCAL_BRIDGE_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .or(file_config.local_port)
        .unwrap_or(DEFAULT_PORT);
    let state = AppState {
        allowed_origins: Arc::new(origins),
        servers: Arc::new(RwLock::new(HashMap::new())),
        pending_keys: Arc::new(Mutex::new(HashMap::new())),
        tunnels: Arc::new(Mutex::new(HashMap::new())),
        snapshots: Arc::new(Mutex::new(HashMap::new())),
    };
    let router = Router::new()
        .route("/health", get(health))
        .route("/api/runtime", get(runtime))
        .route("/api/connect", post(connect))
        .route("/api/reconnect", post(reconnect))
        .route("/api/disconnect", post(disconnect))
        .route("/api/confirm-fingerprint", post(confirm_fingerprint))
        .layer(middleware::from_fn_with_state(state.clone(), cors))
        .with_state(state);
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    println!("SSH Launchpad Rust Bridge listening on http://{address}");
    axum::serve(TcpListener::bind(address).await?, router).await?;
    Ok(())
}

#[cfg(test)]
fn default_allowed_origins() -> Vec<String> {
    DEFAULT_ORIGINS.split(',').map(ToOwned::to_owned).collect()
}

fn load_file_config() -> BridgeFileConfig {
    let path = std::env::var("BRIDGE_CONFIG")
        .ok()
        .map(|value| Path::new(&value).to_path_buf())
        .or_else(|| {
            std::env::current_exe().ok().and_then(|path| {
                path.parent()
                    .map(|parent| parent.join("bridge-config.json"))
            })
        });
    let Some(path) = path else {
        return BridgeFileConfig::default();
    };
    match fs::read_to_string(&path) {
        Ok(contents) => match serde_json::from_str(&contents) {
            Ok(config) => config,
            Err(error) => {
                eprintln!("Ignoring invalid bridge config {}: {error}", path.display());
                BridgeFileConfig::default()
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => BridgeFileConfig::default(),
        Err(error) => {
            eprintln!("Unable to read bridge config {}: {error}", path.display());
            BridgeFileConfig::default()
        }
    }
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        ok: true,
        mode: "rust-local-ssh",
    })
}

async fn runtime(State(state): State<AppState>) -> Json<Vec<RuntimeSnapshot>> {
    Json(state.snapshots.lock().await.values().cloned().collect())
}

async fn cors(State(state): State<AppState>, request: Request<Body>, next: Next) -> Response {
    let origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned);
    if let Some(value) = origin.as_deref() {
        if !state.allowed_origins.iter().any(|allowed| allowed == value) {
            return BridgeError::api("FORBIDDEN", "Local bridge origin is not allowed")
                .into_response();
        }
    }
    let mut response = if request.method() == axum::http::Method::OPTIONS {
        let mut response = Response::new(Body::empty());
        *response.status_mut() = StatusCode::NO_CONTENT;
        response
    } else {
        next.run(request).await
    };
    if let Some(value) = origin
        .as_deref()
        .and_then(|item| HeaderValue::from_str(item).ok())
    {
        response
            .headers_mut()
            .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, value);
        response
            .headers_mut()
            .insert(header::VARY, HeaderValue::from_static("Origin"));
    }
    response.headers_mut().insert(
        "access-control-allow-private-network",
        HeaderValue::from_static("true"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET,POST,OPTIONS"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Content-Type"),
    );
    response
}

async fn connect(
    State(state): State<AppState>,
    Json(request): Json<ConnectRequest>,
) -> Result<Json<ConnectResponse>, BridgeError> {
    connect_inner(state, request, false).await
}

async fn reconnect(
    State(state): State<AppState>,
    Json(request): Json<ConnectRequest>,
) -> Result<Json<ConnectResponse>, BridgeError> {
    connect_inner(state, request, true).await
}

async fn connect_inner(
    state: AppState,
    request: ConnectRequest,
    force_reconnect: bool,
) -> Result<Json<ConnectResponse>, BridgeError> {
    if request.app.server_id != request.server.id {
        return Err(BridgeError::api(
            "VALIDATION_FAILED",
            "Application and server do not match",
        ));
    }
    if request.server.host.is_empty() || request.server.username.is_empty() {
        return Err(BridgeError::api(
            "VALIDATION_FAILED",
            "SSH host and username are required",
        ));
    }
    if force_reconnect {
        stop_tunnel(&state, &request.app.id).await;
    }
    state
        .servers
        .write()
        .await
        .insert(request.server.id.clone(), request.server.clone());
    set_snapshot(&state, &request.app.id, "checking", None).await;
    let key = match open_session(&request.server, request.credential.as_ref(), state.clone()).await
    {
        Ok(handle) => handle,
        Err(error) => {
            set_snapshot(&state, &request.app.id, "error", Some(&error)).await;
            return Err(error);
        }
    };
    if !probe_remote(&key, &request.app.remote_host, request.app.remote_port).await {
        if !request.app.auto_start {
            let error = BridgeError::api(
                "REMOTE_PORT_CLOSED",
                format!(
                    "Remote application port {} is closed",
                    request.app.remote_port
                ),
            );
            set_snapshot(&state, &request.app.id, "error", Some(&error)).await;
            return Err(error);
        }
        set_snapshot(&state, &request.app.id, "starting", None).await;
        if let Err(error) = start_remote(&key, &request.app).await {
            set_snapshot(&state, &request.app.id, "error", Some(&error)).await;
            return Err(error);
        }
        let deadline =
            tokio::time::Instant::now() + Duration::from_millis(request.app.start_timeout_ms);
        while tokio::time::Instant::now() < deadline
            && !probe_remote(&key, &request.app.remote_host, request.app.remote_port).await
        {
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
        if !probe_remote(&key, &request.app.remote_host, request.app.remote_port).await {
            let error = BridgeError::api(
                "REMOTE_START_TIMEOUT",
                "Remote application did not open its port in time",
            );
            set_snapshot(&state, &request.app.id, "error", Some(&error)).await;
            return Err(error);
        }
    }
    set_snapshot(&state, &request.app.id, "tunneling", None).await;
    let tunnel = start_tunnel(key, &request.app).await?;
    let url = format!(
        "{}://127.0.0.1:{}{}",
        request.app.protocol, request.app.local_port, request.app.health_path
    );
    state
        .tunnels
        .lock()
        .await
        .insert(request.app.id.clone(), tunnel);
    set_snapshot(&state, &request.app.id, "healthy", None).await;
    Ok(Json(ConnectResponse {
        url,
        status: "healthy",
    }))
}

async fn disconnect(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, BridgeError> {
    let app_id = body
        .get("appId")
        .and_then(|value| value.as_str())
        .ok_or_else(|| BridgeError::api("VALIDATION_FAILED", "Application id is required"))?;
    stop_tunnel(&state, app_id).await;
    set_snapshot(&state, app_id, "disconnected", None).await;
    Ok(Json(serde_json::json!({"ok": true})))
}

async fn confirm_fingerprint(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<ServerRecord>, BridgeError> {
    let server_id = body
        .get("serverId")
        .and_then(|value| value.as_str())
        .ok_or_else(|| BridgeError::api("VALIDATION_FAILED", "Server id is required"))?;
    let candidate = body
        .get("candidateFingerprint")
        .and_then(|value| value.as_str())
        .ok_or_else(|| {
            BridgeError::api("VALIDATION_FAILED", "Candidate fingerprint is required")
        })?;
    let mut pending = state.pending_keys.lock().await;
    if pending.get(server_id).map(String::as_str) != Some(candidate) {
        return Err(BridgeError::api(
            "FORBIDDEN",
            "Fingerprint confirmation is no longer valid",
        ));
    }
    pending.remove(server_id);
    drop(pending);
    let mut servers = state.servers.write().await;
    let server = servers
        .get_mut(server_id)
        .ok_or_else(|| BridgeError::api("NOT_FOUND", "Server was not found"))?;
    server.host_fingerprint = Some(candidate.to_owned());
    Ok(Json(server.clone()))
}

async fn stop_tunnel(state: &AppState, app_id: &str) {
    if let Some(tunnel) = state.tunnels.lock().await.remove(app_id) {
        let _ = tunnel.stop.send(true);
        tunnel.task.abort();
    }
}

async fn set_snapshot(state: &AppState, app_id: &str, status: &str, error: Option<&BridgeError>) {
    let (error_code, error_message) = error
        .map(|value| (Some(value.code().to_owned()), Some(value.message())))
        .unwrap_or((None, None));
    state.snapshots.lock().await.insert(
        app_id.to_owned(),
        RuntimeSnapshot {
            app_id: app_id.to_owned(),
            status: status.to_owned(),
            started_by_launchpad: false,
            updated_at: Utc::now().to_rfc3339(),
            error_code,
            error_message,
        },
    );
}

type SessionHandle = Arc<Mutex<client::Handle<BridgeHandler>>>;

async fn open_session(
    server: &ServerRecord,
    credential: Option<&Credential>,
    state: AppState,
) -> Result<SessionHandle, BridgeError> {
    let handler = BridgeHandler {
        expected: server.host_fingerprint.clone(),
        state,
        server_id: server.id.clone(),
    };
    let config = Arc::new(client::Config {
        nodelay: true,
        ..Default::default()
    });
    let mut session = client::connect(config, (server.host.clone(), server.port), handler)
        .await
        .map_err(map_handler_error)?;
    let auth = match server.auth_type.as_str() {
        "password" | "ssh-config"
            if credential.map(|item| item.kind.as_str()) == Some("password") =>
        {
            session
                .authenticate_password(
                    server.username.clone(),
                    credential.expect("credential checked").value.clone(),
                )
                .await
        }
        "private-key" => authenticate_key(&mut session, server, credential).await,
        "ssh-config" => authenticate_default_key(&mut session, server, credential).await,
        _ => Err(russh::Error::NotAuthenticated),
    };
    let result = auth.map_err(map_ssh_error)?;
    if !result.success() {
        return Err(BridgeError::api(
            "SSH_AUTH_FAILED",
            "SSH authentication failed",
        ));
    }
    Ok(Arc::new(Mutex::new(session)))
}

async fn authenticate_key(
    session: &mut client::Handle<BridgeHandler>,
    server: &ServerRecord,
    credential: Option<&Credential>,
) -> Result<russh::client::AuthResult, russh::Error> {
    let path = server
        .private_key_path
        .as_deref()
        .ok_or(russh::Error::Inconsistent)?;
    let path = expand_home(path);
    let passphrase = credential
        .filter(|item| item.kind == "private-key-passphrase")
        .map(|item| item.value.as_str());
    let key = keys::load_secret_key(path, passphrase).map_err(|_| russh::Error::Inconsistent)?;
    let hash = session.best_supported_rsa_hash().await?.flatten();
    session
        .authenticate_publickey(
            server.username.clone(),
            PrivateKeyWithHashAlg::new(Arc::new(key), hash),
        )
        .await
}

async fn authenticate_default_key(
    session: &mut client::Handle<BridgeHandler>,
    server: &ServerRecord,
    credential: Option<&Credential>,
) -> Result<russh::client::AuthResult, russh::Error> {
    if let Some(value) = credential.filter(|item| item.kind == "password") {
        return session
            .authenticate_password(server.username.clone(), value.value.clone())
            .await;
    }
    if let Ok(mut agent) = connect_agent().await {
        if let Ok(identities) = agent.request_identities().await {
            let hash = session.best_supported_rsa_hash().await?.flatten();
            for identity in identities {
                let public_key = identity.public_key().into_owned();
                if let Ok(result) = session
                    .authenticate_publickey_with(
                        server.username.clone(),
                        public_key,
                        hash,
                        &mut agent,
                    )
                    .await
                {
                    if result.success() {
                        return Ok(result);
                    }
                }
            }
        }
    }
    for filename in ["id_ed25519", "id_rsa", "id_ecdsa"] {
        let path = expand_home(&format!("~/.ssh/{filename}"));
        if !Path::new(&path).exists() {
            continue;
        }
        if let Ok(key) = keys::load_secret_key(&path, None) {
            let hash = session.best_supported_rsa_hash().await?.flatten();
            if let Ok(result) = session
                .authenticate_publickey(
                    server.username.clone(),
                    PrivateKeyWithHashAlg::new(Arc::new(key), hash),
                )
                .await
            {
                if result.success() {
                    return Ok(result);
                }
            }
        }
    }
    Err(russh::Error::NotAuthenticated)
}

type DynamicAgent = AgentClient<Box<dyn agent::client::AgentStream + Send + Unpin>>;

async fn connect_agent() -> Result<DynamicAgent, russh::keys::Error> {
    #[cfg(unix)]
    {
        return AgentClient::connect_env()
            .await
            .map(|client| client.dynamic());
    }
    #[cfg(windows)]
    {
        if let Ok(path) = std::env::var("SSH_AUTH_SOCK") {
            if let Ok(client) = AgentClient::connect_named_pipe(path).await {
                return Ok(client.dynamic());
            }
        }
        return AgentClient::connect_pageant()
            .await
            .map(|client| client.dynamic());
    }
    #[allow(unreachable_code)]
    Err(russh::keys::Error::AgentFailure)
}

fn expand_home(value: &str) -> String {
    if let Some(rest) = value
        .strip_prefix("~/")
        .or_else(|| value.strip_prefix("~\\"))
    {
        if let Some(home) = home_dir() {
            return format!("{home}{rest}");
        }
    }
    value.replace("%USERPROFILE%", &home_dir().unwrap_or_default())
}

fn home_dir() -> Option<String> {
    std::env::var("USERPROFILE")
        .ok()
        .or_else(|| std::env::var("HOME").ok())
}

async fn probe_remote(session: &SessionHandle, host: &str, port: u16) -> bool {
    session
        .lock()
        .await
        .channel_open_direct_tcpip(host.to_owned(), port as u32, "127.0.0.1", 0)
        .await
        .map(|channel| {
            drop(channel);
            true
        })
        .unwrap_or(false)
}

async fn start_remote(session: &SessionHandle, app: &AppRecord) -> Result<(), BridgeError> {
    let command = app
        .start_command
        .as_deref()
        .ok_or_else(|| BridgeError::api("REMOTE_START_FAILED", "Start command is required"))?;
    let working_directory = app
        .working_directory
        .as_deref()
        .map(|value| format!("cd {} && ", shell_quote(value)))
        .unwrap_or_default();
    let wrapped = format!(
        "{working_directory}nohup sh -lc {} >/tmp/ssh-launchpad-{}.log 2>&1 </dev/null & echo $!",
        shell_quote(command),
        app.id
    );
    let mut channel = session
        .lock()
        .await
        .channel_open_session()
        .await
        .map_err(map_ssh_error)?;
    channel.exec(true, wrapped).await.map_err(map_ssh_error)?;
    while let Some(message) = channel.wait().await {
        if matches!(message, ChannelMsg::Eof | ChannelMsg::Close) {
            break;
        }
    }
    Ok(())
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

async fn start_tunnel(session: SessionHandle, app: &AppRecord) -> Result<Tunnel, BridgeError> {
    let listener = TcpListener::bind(("127.0.0.1", app.local_port))
        .await
        .map_err(|_| {
            BridgeError::api(
                "LOCAL_PORT_IN_USE",
                format!("Local port {} is already in use", app.local_port),
            )
        })?;
    let (stop, mut stopped) = watch::channel(false);
    let remote_host = app.remote_host.clone();
    let remote_port = app.remote_port as u32;
    let local_port = app.local_port;
    let task = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = stopped.changed() => break,
                result = listener.accept() => {
                    let Ok((socket, origin)) = result else { break; };
                    let session = session.clone();
                    let remote_host = remote_host.clone();
                    tokio::spawn(async move {
                        if let Ok(channel) = session.lock().await.channel_open_direct_tcpip(remote_host, remote_port, origin.ip().to_string(), local_port as u32).await {
                            let mut channel = channel.into_stream();
                            let mut socket = socket;
                            let _ = tokio::io::copy_bidirectional(&mut socket, &mut channel).await;
                        }
                    });
                }
            }
        }
    });
    Ok(Tunnel { stop, task })
}

#[derive(Clone)]
struct BridgeHandler {
    expected: Option<String>,
    state: AppState,
    server_id: String,
}

impl client::Handler for BridgeHandler {
    type Error = HandlerError;

    async fn check_server_key(
        &mut self,
        key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let fingerprint = format!(
            "{}",
            key.public_key()
                .fingerprint(russh::keys::ssh_key::HashAlg::Sha256)
        );
        if self.expected.as_deref() == Some(fingerprint.as_str()) {
            return Ok(true);
        }
        self.state
            .pending_keys
            .lock()
            .await
            .insert(self.server_id.clone(), fingerprint.clone());
        Err(HandlerError::UnknownFingerprint(fingerprint))
    }
}

#[derive(Debug)]
enum HandlerError {
    UnknownFingerprint(String),
    Ssh(russh::Error),
}

impl From<russh::Error> for HandlerError {
    fn from(error: russh::Error) -> Self {
        Self::Ssh(error)
    }
}

fn map_ssh_error(error: impl std::fmt::Debug) -> BridgeError {
    let message = format!("{error:?}");
    if message.contains("UnknownFingerprint") {
        return BridgeError::Internal(message);
    }
    if message.to_lowercase().contains("auth") {
        return BridgeError::api("SSH_AUTH_FAILED", "SSH authentication failed");
    }
    BridgeError::api("SSH_CONNECTION_FAILED", "SSH connection failed")
}

fn map_handler_error(error: HandlerError) -> BridgeError {
    match error {
        HandlerError::UnknownFingerprint(fingerprint) => BridgeError::with_details(
            "SSH_HOST_KEY_UNKNOWN",
            "Host key has not been confirmed",
            serde_json::json!({ "candidateFingerprint": fingerprint }),
        ),
        HandlerError::Ssh(error) => map_ssh_error(error),
    }
}

#[cfg(test)]
mod tests {
    use super::default_allowed_origins;

    #[test]
    fn default_origins_include_deployed_control_plane() {
        assert!(
            default_allowed_origins()
                .iter()
                .any(|origin| origin == "https://tyyun.haibao.fun")
        );
    }
}
