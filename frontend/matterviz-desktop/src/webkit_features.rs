//! Enable the renderer feature on Linux without requiring a newer WebKit SDK.
use std::ffi::{c_char, c_void, CStr};
use webkit2gtk::{glib::object::ObjectType, WebView, WebViewExt};

pub fn enable_webgpu(view: &WebView) {
    let Some(settings) = view.settings() else {
        return;
    };
    // WebKitGTK 2.42 added the public feature API, after the SDK supported by
    // Tauri's bindings. Resolve it at runtime so older installations still load.
    // MatterViz gates its Canvas on navigator.gpu; Three then selects WebGPU or
    // its own WebGL2 fallback when an adapter is unavailable.
    let enabled = unsafe { enable_feature(settings.as_ptr().cast()) };
    if !enabled {
        eprintln!("MatterViz: WebKitGTK has no configurable WebGPU feature; 3D rendering requires a newer WebKitGTK runtime");
    }
}

unsafe fn enable_feature(settings: *mut c_void) -> bool {
    macro_rules! symbol {
        ($name:literal, $signature:ty) => {{
            let pointer = libc::dlsym(libc::RTLD_DEFAULT, $name.as_ptr());
            if pointer.is_null() {
                return false;
            }
            std::mem::transmute::<*mut c_void, $signature>(pointer)
        }};
    }
    let all = symbol!(
        c"webkit_settings_get_all_features",
        unsafe extern "C" fn() -> *mut c_void
    );
    let len = symbol!(
        c"webkit_feature_list_get_length",
        unsafe extern "C" fn(*mut c_void) -> u32
    );
    let get = symbol!(
        c"webkit_feature_list_get",
        unsafe extern "C" fn(*mut c_void, u32) -> *mut c_void
    );
    let identifier = symbol!(
        c"webkit_feature_get_identifier",
        unsafe extern "C" fn(*mut c_void) -> *const c_char
    );
    let set = symbol!(
        c"webkit_settings_set_feature_enabled",
        unsafe extern "C" fn(*mut c_void, *mut c_void, i32)
    );
    let unref = symbol!(
        c"webkit_feature_list_unref",
        unsafe extern "C" fn(*mut c_void)
    );
    let list = all();
    if list.is_null() {
        return false;
    }
    let mut found = false;
    for index in 0..len(list) {
        let feature = get(list, index);
        let name = identifier(feature);
        if !name.is_null() && CStr::from_ptr(name) == c"WebGPU" {
            set(settings, feature, 1);
            found = true;
            break;
        }
    }
    unref(list);
    found
}
