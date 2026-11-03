// Node-API symbols on macOS are resolved by the Node host process.
// napi-build sets platform-specific link directives, including
// -undefined dynamic_lookup for cdylibs on Apple platforms.
fn main() {
    napi_build::setup();
}
