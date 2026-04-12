use serde::Serialize;
use serde_json::Value;

#[cfg(desktop)]
use std::sync::Mutex;
#[cfg(desktop)]
use std::time::Duration;
#[cfg(desktop)]
use tauri::{AppHandle, Manager, State};
#[cfg(desktop)]
use tauri_plugin_updater::{Update, UpdaterExt};
#[cfg(desktop)]
use url::Url;

#[cfg(desktop)]
struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdaterStatus {
    current_version: String,
    configured: bool,
    endpoint_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateMetadata {
    version: String,
    current_version: String,
    notes: Option<String>,
    pub_date: Option<String>,
}

#[tauri::command]
async fn fetch_google_sheets(url: String) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|error| format!("Impossible de preparer la requete: {error}"))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Echec de la requete Google Sheets: {error}"))?;

    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("inconnu")
        .to_string();

    if !status.is_success() {
        let body_preview = response
            .text()
            .await
            .unwrap_or_default()
            .chars()
            .take(240)
            .collect::<String>();

        return Err(format!(
            "Google Sheets a repondu avec HTTP {status} et content-type {content_type}. Apercu: {body_preview}"
        ));
    }

    let body = response
        .text()
        .await
        .map_err(|error| format!("Impossible de lire la reponse Google Sheets: {error}"))?;

    serde_json::from_str::<Value>(&body).map_err(|error| {
        let preview = body.chars().take(240).collect::<String>();
        format!(
            "La reponse Google Sheets n est pas un JSON valide. Content-type: {content_type}. Erreur: {error}. Apercu: {preview}"
        )
    })
}

#[tauri::command]
async fn post_google_sheets(url: String, payload: Value) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|error| format!("Impossible de preparer la requete: {error}"))?;

    let response = client
        .post(url)
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("Echec de l envoi Google Sheets: {error}"))?;

    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("inconnu")
        .to_string();

    let body = response
        .text()
        .await
        .map_err(|error| format!("Impossible de lire la reponse Google Sheets: {error}"))?;

    if !status.is_success() {
        let preview = body.chars().take(240).collect::<String>();
        return Err(format!(
            "Google Sheets a repondu avec HTTP {status} et content-type {content_type}. Apercu: {preview}"
        ));
    }

    serde_json::from_str::<Value>(&body).map_err(|error| {
        let preview = body.chars().take(240).collect::<String>();
        format!(
            "La reponse Google Sheets n est pas un JSON valide. Content-type: {content_type}. Erreur: {error}. Apercu: {preview}"
        )
    })
}

#[cfg(desktop)]
fn normalize_multiline_env(value: String) -> String {
    value.replace("\\n", "\n").trim().to_string()
}

#[cfg(desktop)]
fn load_updater_runtime_config() -> Result<(String, Vec<Url>), String> {
    let compile_pubkey = option_env!("BUDGET_PC_UPDATER_PUBKEY")
        .map(str::to_string)
        .unwrap_or_default();
    let runtime_pubkey = std::env::var("TAURI_UPDATER_PUBKEY").unwrap_or_default();
    let pubkey_source = if compile_pubkey.trim().is_empty() {
        runtime_pubkey
    } else {
        compile_pubkey
    };
    let pubkey = normalize_multiline_env(pubkey_source);

    let compile_endpoints = option_env!("BUDGET_PC_UPDATER_ENDPOINTS")
        .map(str::to_string)
        .unwrap_or_default();
    let runtime_endpoints = std::env::var("TAURI_UPDATER_ENDPOINTS").unwrap_or_default();
    let endpoints_raw = if compile_endpoints.trim().is_empty() {
        runtime_endpoints
    } else {
        compile_endpoints
    };
    let endpoints = endpoints_raw
        .split(|char| char == '\n' || char == ';' || char == ',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| Url::parse(value).map_err(|error| format!("Endpoint updater invalide ({value}): {error}")))
        .collect::<Result<Vec<_>, _>>()?;

    if pubkey.is_empty() || endpoints.is_empty() {
        return Err(
            "Updater non configure. Definis TAURI_UPDATER_PUBKEY et TAURI_UPDATER_ENDPOINTS avant le build de release."
                .to_string(),
        );
    }

    Ok((pubkey, endpoints))
}

#[cfg(desktop)]
fn get_updater_status_internal() -> UpdaterStatus {
    match load_updater_runtime_config() {
        Ok((_, endpoints)) => UpdaterStatus {
            current_version: env!("CARGO_PKG_VERSION").to_string(),
            configured: true,
            endpoint_count: endpoints.len(),
        },
        Err(_) => UpdaterStatus {
            current_version: env!("CARGO_PKG_VERSION").to_string(),
            configured: false,
            endpoint_count: 0,
        },
    }
}

#[tauri::command]
fn get_updater_status() -> UpdaterStatus {
    #[cfg(desktop)]
    {
        return get_updater_status_internal();
    }

    #[allow(unreachable_code)]
    UpdaterStatus {
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        configured: false,
        endpoint_count: 0,
    }
}

#[cfg(desktop)]
#[tauri::command]
async fn fetch_app_update(
    app: AppHandle,
    pending_update: State<'_, PendingUpdate>,
) -> Result<Option<UpdateMetadata>, String> {
    let (pubkey, endpoints) = load_updater_runtime_config()?;

    let update = app
        .updater_builder()
        .pubkey(pubkey)
        .endpoints(endpoints)
        .map_err(|error| format!("Impossible de configurer les endpoints updater: {error}"))?
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("Impossible de preparer l updater: {error}"))?
        .check()
        .await
        .map_err(|error| format!("Verification de mise a jour impossible: {error}"))?;

    let metadata = update.as_ref().map(|item| UpdateMetadata {
        version: item.version.clone(),
        current_version: item.current_version.clone(),
        notes: item.body.clone(),
        pub_date: item.date.as_ref().map(ToString::to_string),
    });

    *pending_update
        .0
        .lock()
        .map_err(|_| "Impossible de verrouiller l etat updater.".to_string())? = update;

    Ok(metadata)
}

#[cfg(not(desktop))]
#[tauri::command]
async fn fetch_app_update() -> Result<Option<UpdateMetadata>, String> {
    Ok(None)
}

#[cfg(desktop)]
#[tauri::command]
async fn install_app_update(
    app: AppHandle,
    pending_update: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let update = pending_update
        .0
        .lock()
        .map_err(|_| "Impossible de verrouiller l etat updater.".to_string())?
        .take()
        .ok_or_else(|| "Aucune mise a jour en attente. Relance une verification.".to_string())?;

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| format!("Installation de la mise a jour impossible: {error}"))?;

    app.restart();
}

#[cfg(not(desktop))]
#[tauri::command]
async fn install_app_update() -> Result<(), String> {
    Err("L updater n est pas disponible sur cette plateforme.".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                if let Ok((pubkey, _)) = load_updater_runtime_config() {
                    app.handle().plugin(
                        tauri_plugin_updater::Builder::new()
                            .pubkey(pubkey)
                            .build(),
                    )?;
                }

                app.manage(PendingUpdate(Mutex::new(None)));
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fetch_google_sheets,
            post_google_sheets,
            get_updater_status,
            fetch_app_update,
            install_app_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
