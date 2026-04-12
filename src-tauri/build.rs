use std::env;

fn main() {
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.icns");
    println!("cargo:rerun-if-changed=icons/32x32.png");
    println!("cargo:rerun-if-changed=icons/128x128.png");
    println!("cargo:rerun-if-changed=icons/128x128@2x.png");
    println!("cargo:rerun-if-env-changed=TAURI_UPDATER_PUBKEY");
    println!("cargo:rerun-if-env-changed=TAURI_UPDATER_ENDPOINTS");

    if let Ok(pubkey) = env::var("TAURI_UPDATER_PUBKEY") {
        println!("cargo:rustc-env=BUDGET_PC_UPDATER_PUBKEY={pubkey}");
    }

    if let Ok(endpoints) = env::var("TAURI_UPDATER_ENDPOINTS") {
        println!("cargo:rustc-env=BUDGET_PC_UPDATER_ENDPOINTS={endpoints}");
    }

    tauri_build::build()
}
