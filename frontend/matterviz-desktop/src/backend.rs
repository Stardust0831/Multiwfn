use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

pub const BACKEND_UNAVAILABLE: &str =
    "Multiwfn backend unavailable; restart visualization from menu 0 and keep the terminal open";
const CONSUME_TIMEOUT: Duration = Duration::from_secs(5);
const POLL_INTERVAL: Duration = Duration::from_millis(200);
const ORBITAL_MIN: i64 = 25_000;
const ORBITAL_MAX: i64 = 1_500_000;
const ESP_QUALITIES: [i64; 7] = [
    25_000, 50_000, 120_000, 300_000, 500_000, 1_000_000, 1_500_000,
];
const BOND_METHODS: [&str; 5] = ["mayer", "gwbo", "wiberg_lowdin", "mulliken", "fbo"];
static REQUEST_ID: AtomicU64 = AtomicU64::new(0);

pub struct PendingBackendRequest {
    id: u64,
    request: std::path::PathBuf,
    response: std::path::PathBuf,
    stop: std::path::PathBuf,
    consume_deadline: Instant,
    deadline: Instant,
    timeout_message: String,
    consumed: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct OrbitalRequest {
    pub index: i64,
    pub quality: i64,
    pub isovalue: f64,
}

pub fn parse_orbital_request(
    query: &[(String, String)],
    count: Option<i64>,
) -> Result<OrbitalRequest, String> {
    let index = orbital_scalar(query, "index", "0")?
        .parse::<i64>()
        .map_err(|_| "Orbital index and quality must be integers; isovalue must be numeric")?;
    let quality = orbital_scalar(query, "quality", "0")?
        .parse::<i64>()
        .map_err(|_| "Orbital index and quality must be integers; isovalue must be numeric")?;
    let isovalue = orbital_scalar(query, "isovalue", "0")?
        .parse::<f64>()
        .map_err(|_| "Orbital index and quality must be integers; isovalue must be numeric")?;
    if index < 0 || count.is_some_and(|maximum| index > maximum) {
        return Err(match count {
            Some(maximum) => format!("Orbital index must be between 0 and {maximum}"),
            None => "Orbital index must be a non-negative integer".to_owned(),
        });
    }
    if quality != 0 && !(ORBITAL_MIN..=ORBITAL_MAX).contains(&quality) {
        return Err(format!(
            "Orbital quality must be 0 or between {ORBITAL_MIN} and {ORBITAL_MAX} grid points"
        ));
    }
    if !isovalue.is_finite() || !(0.0..=1.0).contains(&isovalue) {
        return Err("Orbital isovalue must be finite and between 0 and 1".to_owned());
    }
    Ok(OrbitalRequest {
        index,
        quality,
        isovalue,
    })
}

pub fn request_orbital(
    session: &Path,
    query: &[(String, String)],
    manifest: &Path,
    lock: &Mutex<()>,
) -> Value {
    let request = match prepare_orbital_request(query, manifest) {
        Ok(value) => value,
        Err(message) => return json!({"ok": false, "message": message}),
    };
    let result = request_backend(
        session,
        &orbital_request_payload(&request),
        Duration::from_secs(300),
        "Timed out waiting for Multiwfn orbital grid",
        lock,
    );
    if result.get("ok").and_then(Value::as_bool).unwrap_or(false) {
        prune_orbitals(session, 12);
    }
    result
}

pub fn prepare_orbital_request(
    query: &[(String, String)],
    manifest: &Path,
) -> Result<OrbitalRequest, String> {
    parse_orbital_request(query, manifest_orbital_count(manifest))
}

pub fn orbital_request_payload(request: &OrbitalRequest) -> String {
    format!(
        "orbital {} {} {}",
        request.index,
        request.quality,
        significant(request.isovalue)
    )
}

pub fn request_bond(session: &Path, query: &[(String, String)], lock: &Mutex<()>) -> Value {
    let atom1 = match scalar_or_default(query, "atom1", "0").parse::<i64>() {
        Ok(value) => value,
        Err(_) => return json!({"ok": false, "message": "Atom indices must be integers"}),
    };
    let atom2 = match scalar_or_default(query, "atom2", "0").parse::<i64>() {
        Ok(value) => value,
        Err(_) => return json!({"ok": false, "message": "Atom indices must be integers"}),
    };
    let method = scalar_or_default(query, "method", "").to_ascii_lowercase();
    if atom1 <= 0 || atom2 <= 0 || atom1 == atom2 {
        return json!({"ok": false, "message": "Two distinct positive atom indices are required"});
    }
    if !BOND_METHODS.contains(&method.as_str()) {
        return json!({"ok": false, "message": "Unsupported bond-order method"});
    }
    let timeout = if method == "fbo" {
        Duration::from_secs(900)
    } else {
        Duration::from_secs(300)
    };
    request_backend(
        session,
        &format!("bond {atom1} {atom2} {method}"),
        timeout,
        &format!("Timed out waiting for Multiwfn {method} calculation"),
        lock,
    )
}

pub fn request_esp(session: &Path, query: &[(String, String)], lock: &Mutex<()>) -> Value {
    let quality = match scalar_or_default(query, "quality", "120000").parse::<i64>() {
        Ok(value) => value,
        Err(_) => {
            return json!({"ok": false, "message": "ESP quality and isovalue must be numeric"})
        }
    };
    let isovalue = match scalar_or_default(query, "isovalue", "0.001").parse::<f64>() {
        Ok(value) => value,
        Err(_) => {
            return json!({"ok": false, "message": "ESP quality and isovalue must be numeric"})
        }
    };
    if !ESP_QUALITIES.contains(&quality) {
        return json!({"ok": false, "message": "Unsupported ESP grid quality"});
    }
    if !isovalue.is_finite() || isovalue <= 0.0 || isovalue > 0.1 {
        return json!({"ok": false, "message": "ESP density isovalue must be between 0 and 0.1 a.u."});
    }
    let result = request_backend(
        session,
        &format!("esp {quality} {}", significant(isovalue)),
        Duration::from_secs(900),
        "Timed out waiting for Multiwfn ESP calculation",
        lock,
    );
    if result.get("ok").and_then(Value::as_bool).unwrap_or(false) {
        prune_esp(session, &result);
    }
    result
}

fn request_backend(
    session: &Path,
    payload: &str,
    timeout: Duration,
    timeout_message: &str,
    lock: &Mutex<()>,
) -> Value {
    let _guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let id = reserve_request_id();
    match start_backend_request(session, id, payload, timeout, timeout_message) {
        Ok(mut pending) => pending.wait(),
        Err(value) => value,
    }
}

pub fn start_backend_request(
    session: &Path,
    id: u64,
    payload: &str,
    timeout: Duration,
    timeout_message: &str,
) -> Result<PendingBackendRequest, Value> {
    let stop = session.join("gui_stop.flag");
    if stop.is_file() {
        return Err(json!({"ok": false, "message": BACKEND_UNAVAILABLE}));
    }
    let request = session.join("gui_request.txt");
    let response = session.join(format!("response_{id}.json"));
    let _ = fs::remove_file(&response);
    if let Err(error) = fs::write(&request, format!("{id} {payload}\n")) {
        return Err(json!({"ok": false, "message": error.to_string()}));
    }
    Ok(PendingBackendRequest {
        id,
        request,
        response,
        stop,
        consume_deadline: Instant::now() + CONSUME_TIMEOUT,
        deadline: Instant::now() + timeout,
        timeout_message: timeout_message.to_owned(),
        consumed: false,
    })
}

impl PendingBackendRequest {
    pub fn poll(&mut self) -> Option<Value> {
        if let Ok(text) = fs::read_to_string(&self.response) {
            if let Ok(value) = serde_json::from_str::<Value>(&text) {
                return Some(value);
            }
        }
        if self.stop.is_file() {
            self.remove_unconsumed_request();
            return Some(json!({"ok": false, "message": BACKEND_UNAVAILABLE}));
        }
        if !self.consumed && !self.request.is_file() {
            self.consumed = true;
        }
        if !self.consumed && Instant::now() >= self.consume_deadline {
            match fs::read_to_string(&self.request) {
                Ok(text) if text.starts_with(&format!("{} ", self.id)) => {
                    let _ = fs::remove_file(&self.request);
                    return Some(json!({"ok": false, "message": BACKEND_UNAVAILABLE}));
                }
                Ok(_) => {
                    return Some(json!({"ok": false, "message": "Backend request was superseded; try again"}));
                }
                Err(_) => self.consumed = true,
            }
        }
        if Instant::now() >= self.deadline {
            return Some(json!({"ok": false, "message": self.timeout_message.clone()}));
        }
        None
    }

    pub fn wait(&mut self) -> Value {
        loop {
            if let Some(value) = self.poll() {
                return value;
            }
            thread::sleep(POLL_INTERVAL);
        }
    }

    fn remove_unconsumed_request(&self) {
        if !self.consumed
            && fs::read_to_string(&self.request)
                .map(|text| text.starts_with(&format!("{} ", self.id)))
                .unwrap_or(false)
        {
            let _ = fs::remove_file(&self.request);
        }
    }
}

pub fn reserve_request_id() -> u64 {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    loop {
        let previous = REQUEST_ID.load(Ordering::Acquire);
        let next = now.max(previous.saturating_add(1));
        if REQUEST_ID
            .compare_exchange(previous, next, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            return next;
        }
    }
}

fn scalar_or_default<'a>(query: &'a [(String, String)], key: &str, default: &'a str) -> &'a str {
    query
        .iter()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or(default)
}

fn significant(value: f64) -> String {
    if value == 0.0 {
        return "0".to_owned();
    }
    let exponent = value.abs().log10().floor() as i32;
    if !(-4..10).contains(&exponent) {
        let scientific = format!("{value:.9e}");
        let (mantissa, exponent) = scientific.split_once('e').expect("scientific notation");
        let exponent: i32 = exponent.parse().expect("scientific exponent");
        return format!("{}e{exponent:+03}", trim_decimal(mantissa));
    }
    let precision = (9 - exponent).max(0) as usize;
    trim_decimal(&format!("{value:.precision$}"))
}

fn trim_decimal(value: &str) -> String {
    if !value.contains('.') {
        return value.to_owned();
    }
    let trimmed = value.trim_end_matches('0').trim_end_matches('.');
    if trimmed == "-0" {
        "0".to_owned()
    } else {
        trimmed.to_owned()
    }
}

fn orbital_scalar<'a>(
    query: &'a [(String, String)],
    key: &str,
    default: &'a str,
) -> Result<&'a str, String> {
    let values: Vec<_> = query
        .iter()
        .filter(|(name, _)| name == key)
        .map(|(_, value)| value.as_str())
        .collect();
    match values.as_slice() {
        [] => Ok(default),
        [value] => Ok(if value.trim().is_empty() {
            default
        } else {
            value.trim()
        }),
        _ => Err(format!("Orbital {key} must be provided once")),
    }
}

fn manifest_orbital_count(path: &Path) -> Option<i64> {
    let payload: Value = serde_json::from_str(&fs::read_to_string(path).ok()?).ok()?;
    let count = [
        payload.get("orbitals").and_then(|value| value.get("count")),
        payload
            .get("multiwfnGui")
            .and_then(|value| value.get("state"))
            .and_then(|value| value.get("orbitalCount")),
    ]
    .into_iter()
    .flatten()
    .filter_map(|value| {
        value.as_i64().or_else(|| {
            value
                .as_f64()
                .filter(|number| number.is_finite() && number.fract() == 0.0)
                .map(|number| number as i64)
        })
    })
    .find(|value| *value >= 0);
    count
}

fn prune_orbitals(session: &Path, keep: usize) {
    let mut paths: Vec<_> = match fs::read_dir(session) {
        Ok(entries) => entries
            .filter_map(Result::ok)
            .filter(|entry| {
                entry.file_name().to_string_lossy().starts_with("orbital_")
                    && entry.path().extension().is_some_and(|ext| ext == "cube")
            })
            .collect(),
        Err(_) => return,
    };
    paths.sort_by_key(|entry| {
        entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
    });
    if paths.len() > keep {
        for entry in &paths[..paths.len() - keep] {
            let _ = fs::remove_file(entry.path());
        }
    }
}

fn prune_esp(session: &Path, result: &Value) {
    let keep: Vec<String> = ["densityLayer", "espLayer"]
        .into_iter()
        .filter_map(|key| {
            result
                .get(key)
                .and_then(|value| value.get("path"))
                .and_then(Value::as_str)
                .and_then(|value| Path::new(value).file_name())
                .map(|value| value.to_string_lossy().into_owned())
        })
        .collect();
    if let Ok(entries) = fs::read_dir(session) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if (name.starts_with("esp_density_") || name.starts_with("esp_potential_"))
                && name.ends_with(".cube")
                && !keep.contains(&name)
            {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_orbital_request, request_orbital, scalar_or_default, significant};
    use std::fs;
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};

    fn query(values: &[(&str, &str)]) -> Vec<(String, String)> {
        values
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect()
    }

    #[test]
    fn orbital_parser_enforces_duplicates_and_bounds() {
        assert!(
            parse_orbital_request(&query(&[("index", "3"), ("index", "4")]), None)
                .unwrap_err()
                .contains("provided once")
        );
        assert!(parse_orbital_request(&query(&[("quality", "24999")]), None).is_err());
        assert!(parse_orbital_request(&query(&[("isovalue", "NaN")]), None).is_err());
        assert!(parse_orbital_request(&query(&[("index", "5")]), Some(4)).is_err());
    }

    #[test]
    fn blank_scalar_values_use_defaults_and_nonblank_values_are_trimmed() {
        let values = query(&[("quality", ""), ("method", " MAYER ")]);
        assert_eq!(scalar_or_default(&values, "quality", "120000"), "120000");
        assert_eq!(scalar_or_default(&values, "method", ""), "MAYER");
    }

    #[test]
    fn significant_format_matches_ten_digit_general_format() {
        assert_eq!(significant(0.0), "0");
        assert_eq!(significant(0.05), "0.05");
        assert_eq!(significant(0.001), "0.001");
        assert_eq!(significant(1.0 / 3.0), "0.3333333333");
        assert_eq!(significant(0.00001), "1e-05");
    }

    #[test]
    fn orbital_request_round_trips_through_the_existing_file_protocol() {
        let session = std::env::temp_dir().join(format!(
            "matterviz-backend-test-{}-{:?}",
            std::process::id(),
            thread::current().id()
        ));
        let _ = fs::remove_dir_all(&session);
        fs::create_dir_all(&session).unwrap();
        let manifest = session.join("manifest.json");
        fs::write(&manifest, r#"{"orbitals":{"count":5}}"#).unwrap();
        let lock = Arc::new(Mutex::new(()));
        let worker_session = session.clone();
        let worker_manifest = manifest.clone();
        let worker_lock = lock.clone();
        let worker = thread::spawn(move || {
            request_orbital(
                &worker_session,
                &query(&[("index", "3"), ("quality", "120000"), ("isovalue", "0.05")]),
                &worker_manifest,
                &worker_lock,
            )
        });

        let request_path = session.join("gui_request.txt");
        let deadline = Instant::now() + Duration::from_secs(2);
        while !request_path.is_file() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        let request = fs::read_to_string(&request_path).unwrap();
        let (request_id, payload) = request.trim_end().split_once(' ').unwrap();
        assert_eq!(payload, "orbital 3 120000 0.05");
        fs::remove_file(request_path).unwrap();
        fs::write(
            session.join(format!("response_{request_id}.json")),
            r#"{"ok":true,"path":"orbital_3_120000.cube"}"#,
        )
        .unwrap();

        let response = worker.join().unwrap();
        assert_eq!(
            response.get("ok").and_then(|value| value.as_bool()),
            Some(true)
        );
        let _ = fs::remove_dir_all(session);
    }
}
