fn main() {
    // The web app URL is baked in at compile time (see base_url in lib.rs).
    println!("cargo:rerun-if-env-changed=MIMUS_URL");
    tauri_build::build()
}
