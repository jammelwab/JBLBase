use axum::{
    extract::Query,
    response::{Html, IntoResponse},
    routing::get,
    Extension, Router,
};
use log::info;
use oauth2::{
    basic::BasicClient, reqwest::async_http_client, AuthUrl, AuthorizationCode, ClientId,
    CsrfToken, PkceCodeChallenge, PkceCodeVerifier, RedirectUrl, Scope, TokenResponse, TokenUrl,
};
use serde::Deserialize;
use std::{
    net::{SocketAddr, TcpListener},
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::{error::Error, AppState};

fn create_client(redirect_url: RedirectUrl) -> BasicClient {
    let client_id = ClientId::new("org.encroissant.app".to_string());
    let auth_url = AuthUrl::new("https://lichess.org/oauth".to_string());
    let token_url = TokenUrl::new("https://lichess.org/api/token".to_string());

    BasicClient::new(client_id, None, auth_url.unwrap(), token_url.ok())
        .set_redirect_uri(redirect_url)
}

fn get_available_addr() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    drop(listener);

    addr
}

#[derive(Clone)]
pub struct AuthState {
    pub csrf_token: CsrfToken,
    pub pkce: Arc<(PkceCodeChallenge, String)>,
    pub client: Arc<BasicClient>,
    pub socket_addr: SocketAddr,
    /// Event that receives the access token: "access_token" for a Lichess
    /// account in the app, "cloud_lichess_token" for the JBLBase login.
    pub event: Arc<Mutex<&'static str>>,
}

impl Default for AuthState {
    fn default() -> Self {
        let (pkce_code_challenge, pkce_code_verifier) = PkceCodeChallenge::new_random_sha256();
        let socket_addr = get_available_addr();
        let redirect_url = format!("http://{socket_addr}/callback");
        AuthState {
            csrf_token: CsrfToken::new_random(),
            pkce: Arc::new((
                pkce_code_challenge,
                PkceCodeVerifier::secret(&pkce_code_verifier).to_string(),
            )),
            client: Arc::new(create_client(RedirectUrl::new(redirect_url).unwrap())),
            socket_addr,
            event: Arc::new(Mutex::new("access_token")),
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn authenticate(
    username: String,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), Error> {
    start_login(username, "access_token", state, app)
}

/// Lichess login for the JBLBase account. Same flow as `authenticate`, but
/// the token goes to the event "cloud_lichess_token", so no Lichess account
/// is added to the app's account list.
#[tauri::command]
#[specta::specta]
pub async fn authenticate_cloud(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), Error> {
    start_login(String::new(), "cloud_lichess_token", state, app)
}

fn start_login(
    username: String,
    event: &'static str,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), Error> {
    info!("Starting Lichess login ({event})");
    if let Ok(mut current) = state.auth.event.lock() {
        *current = event;
    }
    let mut request = state
        .auth
        .client
        .authorize_url(|| state.auth.csrf_token.clone())
        .add_scope(Scope::new("preference:read".to_string()));
    if !username.is_empty() {
        request = request.add_extra_param("username", username);
    }
    let (auth_url, _) = request.set_pkce_challenge(state.auth.pkce.0.clone()).url();
    app.opener().open_url(auth_url.as_str(), None::<&str>)?;
    let _server_handle = tauri::async_runtime::spawn(async move { run_server(app).await });
    Ok(())
}

/// Lichess calls back with `code` and `state`, or, when the user declines,
/// with `error` (and maybe `error_description`) instead of a code.
#[derive(Deserialize, Default)]
struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

/// Event the app gets when the Lichess login did not give a token (#93).
pub const AUTH_FAILED_EVENT: &str = "lichess_auth_failed";

#[derive(Debug, PartialEq)]
enum Callback {
    Code(String),
    /// The user declined on Lichess.
    Denied,
    /// Not our request (other state), or a broken callback.
    Invalid(String),
}

fn read_callback(query: &CallbackQuery, csrf: &str) -> Callback {
    if let Some(error) = &query.error {
        return if error == "access_denied" {
            Callback::Denied
        } else {
            Callback::Invalid(
                query
                    .error_description
                    .clone()
                    .unwrap_or_else(|| error.clone()),
            )
        };
    }
    if query.state.as_deref() != Some(csrf) {
        return Callback::Invalid("state does not match".into());
    }
    match &query.code {
        Some(code) if !code.is_empty() => Callback::Code(code.clone()),
        _ => Callback::Invalid("no code".into()),
    }
}

/// A short page for the browser tab, in German like the app.
fn page(title: &str, text: &str) -> Html<String> {
    Html(format!(
        "<!doctype html><html lang=\"de\"><meta charset=\"utf-8\"><title>JBLBase</title>\
         <body style=\"font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem\">\
         <h1>{title}</h1><p>{text}</p></body></html>"
    ))
}

fn report_failure(app: &tauri::AppHandle, reason: &str) {
    log::warn!("Lichess login failed: {reason}");
    if let Err(e) = app.emit(AUTH_FAILED_EVENT, reason) {
        log::error!("Could not report the failed Lichess login: {e}");
    }
}

async fn authorize(
    app: Extension<tauri::AppHandle>,
    Query(query): Query<CallbackQuery>,
) -> impl IntoResponse {
    let auth = &app.state::<AppState>().auth;

    let code = match read_callback(&query, auth.csrf_token.secret()) {
        Callback::Code(code) => code,
        Callback::Denied => {
            report_failure(&app, "denied");
            return page(
                "Anmeldung abgebrochen",
                "Du hast den Zugriff auf Lichess abgelehnt. Du kannst dieses Fenster schließen.",
            );
        }
        Callback::Invalid(reason) => {
            report_failure(&app, &reason);
            return page(
                "Anmeldung fehlgeschlagen",
                "Die Antwort von Lichess war ungültig. Bitte in JBLBase erneut versuchen.",
            );
        }
    };

    let token = auth
        .client
        .exchange_code(AuthorizationCode::new(code))
        .set_pkce_verifier(PkceCodeVerifier::new(auth.pkce.1.clone()))
        .request_async(async_http_client)
        .await;
    let token = match token {
        Ok(token) => token,
        Err(e) => {
            report_failure(&app, &e.to_string());
            return page(
                "Anmeldung fehlgeschlagen",
                "Lichess hat die Anmeldung nicht bestätigt (keine Verbindung oder Fehler bei Lichess). Bitte in JBLBase erneut versuchen.",
            );
        }
    };

    let access_token = token.access_token().secret();
    let event = auth.event.lock().map(|e| *e).unwrap_or("access_token");
    if let Err(e) = app.emit(event, access_token) {
        report_failure(&app, &e.to_string());
    }

    page(
        "Angemeldet",
        "Die Anmeldung bei Lichess hat geklappt. Du kannst dieses Fenster schließen.",
    )
}

async fn run_server(handle: tauri::AppHandle) -> Result<(), axum::Error> {
    let app = Router::new()
        .route("/callback", get(authorize))
        .layer(Extension(handle.clone()));

    let _ = axum::Server::bind(&handle.state::<AppState>().auth.socket_addr.clone())
        .serve(app.into_make_service())
        .await;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query(pairs: &str) -> CallbackQuery {
        let mut q = CallbackQuery::default();
        for pair in pairs.split('&') {
            let (k, v) = pair.split_once('=').unwrap();
            let v = Some(v.replace('+', " "));
            match k {
                "code" => q.code = v,
                "state" => q.state = v,
                "error" => q.error = v,
                "error_description" => q.error_description = v,
                _ => {}
            }
        }
        q
    }

    #[test]
    fn reads_the_callbacks_lichess_sends() {
        assert_eq!(
            read_callback(&query("code=abc&state=s1"), "s1"),
            Callback::Code("abc".into())
        );
        // "Ablehnen" on Lichess: no code, only an error (#93).
        assert_eq!(
            read_callback(
                &query("error=access_denied&error_description=user+cancelled&state=s1"),
                "s1"
            ),
            Callback::Denied
        );
        assert!(matches!(
            read_callback(&query("code=abc&state=other"), "s1"),
            Callback::Invalid(_)
        ));
        assert!(matches!(
            read_callback(&query("state=s1"), "s1"),
            Callback::Invalid(_)
        ));
        assert!(matches!(
            read_callback(&query("error=server_error"), "s1"),
            Callback::Invalid(_)
        ));
    }
}
