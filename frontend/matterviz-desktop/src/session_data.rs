//! Validated in-memory data carried by a `session_init` control frame.
//!
//! The control decoder validates framing and the common control envelope, but
//! this module deliberately validates those fields again.  A `ControlFrame`
//! can also be constructed by code (rather than decoded from the pipe), and
//! session bootstrap must not trust such a value without checking it.

use std::fmt;
use std::sync::Arc;

use serde_json::Value;

use crate::control_protocol::{ControlFrame, MessageType};

const CONTROL_FORMAT: &str = "multiwfn-matterviz-control";
const CONTROL_VERSION: u64 = 1;
const SESSION_KIND: &str = "session_init";
const WORKBENCH_FORMAT: &str = "multiwfn-matterviz-workbench";
const WORKBENCH_VERSION: u64 = 2;

/// Errors returned when a control frame cannot be used to bootstrap a
/// MatterViz session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SessionDataError {
    WrongMessageType,
    MissingBody,
    BodyNotObject,
    MissingField(&'static str),
    MissingManifestField(&'static str),
    InvalidEnvelopeFormat,
    InvalidEnvelopeVersion,
    InvalidKind,
    ManifestNotObject,
    InvalidManifestFormat,
    InvalidManifestVersion,
    InvalidManifestEntry,
    InvalidOptionalObject(&'static str),
    Serialization,
}

impl fmt::Display for SessionDataError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::WrongMessageType => {
                f.write_str("session bootstrap requires a session_init frame")
            }
            Self::MissingBody => f.write_str("session_init frame is missing its body"),
            Self::BodyNotObject => f.write_str("session_init body must be a JSON object"),
            Self::MissingField(field) => {
                write!(f, "session_init body is missing required field {field:?}")
            }
            Self::MissingManifestField(field) => {
                write!(
                    f,
                    "session_init manifest is missing required field {field:?}"
                )
            }
            Self::InvalidEnvelopeFormat => {
                write!(f, "session_init envelope format must be {CONTROL_FORMAT:?}")
            }
            Self::InvalidEnvelopeVersion => {
                write!(
                    f,
                    "session_init envelope version must be integer {CONTROL_VERSION}"
                )
            }
            Self::InvalidKind => f.write_str("session_init envelope kind must be \"session_init\""),
            Self::ManifestNotObject => f.write_str("session_init manifest must be a JSON object"),
            Self::InvalidManifestFormat => {
                write!(f, "manifest format must be {WORKBENCH_FORMAT:?}")
            }
            Self::InvalidManifestVersion => {
                write!(f, "manifest version must be integer {WORKBENCH_VERSION}")
            }
            Self::InvalidManifestEntry => f.write_str(
                "formal manifest entries must use in-memory session or volume API paths",
            ),
            Self::InvalidOptionalObject(field) => {
                write!(f, "session_init {field} must be a JSON object or null")
            }
            Self::Serialization => f.write_str("session_init JSON object could not be serialized"),
        }
    }
}

impl std::error::Error for SessionDataError {}

/// Session objects retained as immutable, cheaply shareable JSON bytes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SessionData {
    manifest: Arc<[u8]>,
    structure: Option<Arc<[u8]>>,
    state: Option<Arc<[u8]>>,
}

impl SessionData {
    /// Validate and retain the payload of a decoded `session_init` frame.
    pub(crate) fn parse(frame: &ControlFrame) -> Result<Self, SessionDataError> {
        if frame.header.message_type != MessageType::SessionInit {
            return Err(SessionDataError::WrongMessageType);
        }
        let body = frame.body.as_ref().ok_or(SessionDataError::MissingBody)?;
        let object = body.as_object().ok_or(SessionDataError::BodyNotObject)?;

        require_string(
            object,
            "format",
            CONTROL_FORMAT,
            SessionDataError::InvalidEnvelopeFormat,
            SessionDataError::MissingField("format"),
        )?;
        require_integer(
            object,
            "version",
            CONTROL_VERSION,
            SessionDataError::InvalidEnvelopeVersion,
            SessionDataError::MissingField("version"),
        )?;
        require_string(
            object,
            "kind",
            SESSION_KIND,
            SessionDataError::InvalidKind,
            SessionDataError::MissingField("kind"),
        )?;

        let manifest = object
            .get("manifest")
            .ok_or(SessionDataError::MissingField("manifest"))?;
        let manifest_object = manifest
            .as_object()
            .ok_or(SessionDataError::ManifestNotObject)?;
        require_string(
            manifest_object,
            "format",
            WORKBENCH_FORMAT,
            SessionDataError::InvalidManifestFormat,
            SessionDataError::MissingManifestField("format"),
        )?;
        require_integer(
            manifest_object,
            "version",
            WORKBENCH_VERSION,
            SessionDataError::InvalidManifestVersion,
            SessionDataError::MissingManifestField("version"),
        )?;
        validate_manifest_entries(manifest_object)?;

        let manifest = serialize(manifest)?;
        let structure = optional_object(object, "structure")?;
        let structure = structure.map(serialize).transpose()?;
        let state = optional_object(object, "state")?;
        let state = state.map(serialize).transpose()?;

        Ok(Self {
            manifest,
            structure,
            state,
        })
    }

    /// Alias for [`Self::parse`] that makes the expected input explicit.
    pub(crate) fn from_frame(frame: &ControlFrame) -> Result<Self, SessionDataError> {
        Self::parse(frame)
    }

    /// Serialized manifest JSON.
    pub(crate) fn manifest_bytes(&self) -> &[u8] {
        &self.manifest
    }

    /// Serialized structure JSON, if supplied by the bootstrap frame.
    pub(crate) fn structure_bytes(&self) -> Option<&[u8]> {
        self.structure.as_deref()
    }

    /// Serialized workbench state JSON, if supplied by the bootstrap frame.
    pub(crate) fn state_bytes(&self) -> Option<&[u8]> {
        self.state.as_deref()
    }
}

fn validate_manifest_entries(
    manifest: &serde_json::Map<String, Value>,
) -> Result<(), SessionDataError> {
    if let Some(structure) = manifest.get("structure") {
        let valid = structure.is_null()
            || structure
                .as_object()
                .and_then(|entry| entry.get("path"))
                .and_then(Value::as_str)
                == Some("structure.json");
        if !valid {
            return Err(SessionDataError::InvalidManifestEntry);
        }
    }
    for field in ["cubes", "layers"] {
        let Some(entries) = manifest.get(field) else {
            continue;
        };
        let entries = entries
            .as_array()
            .ok_or(SessionDataError::InvalidManifestEntry)?;
        for entry in entries {
            let path = entry
                .as_object()
                .and_then(|entry| entry.get("path"))
                .and_then(Value::as_str)
                .ok_or(SessionDataError::InvalidManifestEntry)?;
            path.strip_prefix("/api/volume/")
                .and_then(|value| value.parse::<u64>().ok())
                .filter(|value| *value > 0)
                .ok_or(SessionDataError::InvalidManifestEntry)?;
        }
    }
    Ok(())
}

fn require_string(
    object: &serde_json::Map<String, Value>,
    field: &'static str,
    expected: &str,
    error: SessionDataError,
    missing: SessionDataError,
) -> Result<(), SessionDataError> {
    if object.get(field).and_then(Value::as_str) == Some(expected) {
        Ok(())
    } else if object.get(field).is_none() {
        Err(missing)
    } else {
        Err(error)
    }
}

fn require_integer(
    object: &serde_json::Map<String, Value>,
    field: &'static str,
    expected: u64,
    error: SessionDataError,
    missing: SessionDataError,
) -> Result<(), SessionDataError> {
    if object.get(field).and_then(Value::as_u64) == Some(expected) {
        Ok(())
    } else if object.get(field).is_none() {
        Err(missing)
    } else {
        Err(error)
    }
}

fn optional_object<'a>(
    object: &'a serde_json::Map<String, Value>,
    field: &'static str,
) -> Result<Option<&'a Value>, SessionDataError> {
    match object.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Object(_)) => Ok(object.get(field)),
        Some(_) => Err(SessionDataError::InvalidOptionalObject(field)),
    }
}

fn serialize(value: &Value) -> Result<Arc<[u8]>, SessionDataError> {
    serde_json::to_vec(value)
        .map(Vec::into_boxed_slice)
        .map(Arc::<[u8]>::from)
        .map_err(|_| SessionDataError::Serialization)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::control_protocol::{ControlHeader, MessageType};
    use serde_json::json;

    fn frame(body: Value) -> ControlFrame {
        ControlFrame {
            header: ControlHeader {
                message_type: MessageType::SessionInit,
                flags: 0,
                request_id: 0,
                body_bytes: 1,
                header_crc32c: 0,
                body_crc32c: 0,
            },
            body: Some(body),
        }
    }

    fn valid_body() -> Value {
        json!({
            "format": CONTROL_FORMAT,
            "version": CONTROL_VERSION,
            "kind": SESSION_KIND,
            "manifest": {
                "format": WORKBENCH_FORMAT,
                "version": WORKBENCH_VERSION,
                "cubes": []
            },
            "structure": {"atoms": []},
            "state": {"camera": {"zoom": 1}}
        })
    }

    #[test]
    fn accepts_valid_session_init_and_retains_objects() {
        let data = SessionData::parse(&frame(valid_body())).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(data.manifest_bytes()).unwrap()["version"],
            2
        );
        assert_eq!(
            serde_json::from_slice::<Value>(data.structure_bytes().unwrap()).unwrap(),
            json!({"atoms": []})
        );
        assert_eq!(
            serde_json::from_slice::<Value>(data.state_bytes().unwrap()).unwrap(),
            json!({"camera": {"zoom": 1}})
        );
    }

    #[test]
    fn rejects_wrong_frame_and_missing_body() {
        let mut wrong = frame(valid_body());
        wrong.header.message_type = MessageType::Request;
        assert_eq!(
            SessionData::parse(&wrong),
            Err(SessionDataError::WrongMessageType)
        );

        let mut missing = frame(valid_body());
        missing.body = None;
        assert_eq!(
            SessionData::parse(&missing),
            Err(SessionDataError::MissingBody)
        );
    }

    #[test]
    fn rejects_malformed_manifest_and_versions() {
        let mut missing = valid_body();
        missing.as_object_mut().unwrap().remove("manifest");
        assert_eq!(
            SessionData::parse(&frame(missing)),
            Err(SessionDataError::MissingField("manifest"))
        );

        let mut wrong_format = valid_body();
        wrong_format["manifest"]["format"] = json!("other");
        assert_eq!(
            SessionData::parse(&frame(wrong_format)),
            Err(SessionDataError::InvalidManifestFormat)
        );

        let mut wrong_version = valid_body();
        wrong_version["manifest"]["version"] = json!("2");
        assert_eq!(
            SessionData::parse(&frame(wrong_version)),
            Err(SessionDataError::InvalidManifestVersion)
        );
    }

    #[test]
    fn rejects_invalid_optional_objects() {
        for field in ["structure", "state"] {
            let mut body = valid_body();
            body[field] = json!([]);
            assert_eq!(
                SessionData::parse(&frame(body)),
                Err(SessionDataError::InvalidOptionalObject(field))
            );
        }

        let mut nulls = valid_body();
        nulls["structure"] = Value::Null;
        nulls["state"] = Value::Null;
        let data = SessionData::parse(&frame(nulls)).unwrap();
        assert!(data.structure_bytes().is_none());
        assert!(data.state_bytes().is_none());
    }

    #[test]
    fn rejects_external_or_malformed_formal_manifest_entries() {
        for manifest_patch in [
            json!({"structure": {"path": "https://example.test/structure.json"}}),
            json!({"cubes": [{"path": "https://example.test/volume"}]}),
            json!({"cubes": [{"path": "/api/volume/0"}]}),
            json!({"cubes": [{"path": "/api/volume/not-an-id"}]}),
            json!({"layers": [{"path": "https://example.test/volume"}]}),
        ] {
            let mut body = valid_body();
            let manifest = body["manifest"].as_object_mut().unwrap();
            manifest.extend(manifest_patch.as_object().unwrap().clone());
            assert_eq!(
                SessionData::parse(&frame(body)),
                Err(SessionDataError::InvalidManifestEntry)
            );
        }
    }

    #[test]
    fn accepts_a_structureless_formal_manifest() {
        let mut body = valid_body();
        body["manifest"]["structure"] = Value::Null;
        assert!(SessionData::parse(&frame(body)).is_ok());
    }
}
