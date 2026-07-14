fn main() {
    println!("cargo:rerun-if-changed=../../noGUI/matterviz_spawn.c");
    cc::Build::new()
        .file("../../noGUI/matterviz_spawn.c")
        .warnings(true)
        .compile("matterviz_spawn_test");
    if std::env::var("CARGO_CFG_TARGET_FAMILY").as_deref() == Ok("unix") {
        println!("cargo:rustc-link-lib=pthread");
    }
}
