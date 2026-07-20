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
const PLOT_FORMAT: &str = "multiwfn-matterviz-plot";
const PLOT_VERSION: u64 = 1;
const PLOT_V2_VERSION: u64 = 2;
const MAX_PLOT_SERIES: usize = 128;
const MAX_PLOT_POINTS: usize = 2_000_000;
const MAX_PLOT_STICKS_POINTS: usize = 100_000;
const MAX_PLOT_LABELS: usize = 20_000;

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
    InvalidManifestPlot(&'static str),
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
            Self::InvalidManifestPlot(reason) => {
                write!(f, "manifest plot is invalid: {reason}")
            }
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
        validate_manifest_plot(manifest_object)?;

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

#[derive(Default)]
struct PlotLimits {
    series: usize,
    points: usize,
    sticks_points: usize,
    labels: usize,
}

impl PlotLimits {
    fn add_series(
        &mut self,
        points: usize,
        sticks: bool,
        labels: usize,
    ) -> Result<(), SessionDataError> {
        self.series = self
            .series
            .checked_add(1)
            .ok_or(SessionDataError::InvalidManifestPlot("series limit"))?;
        self.points = self
            .points
            .checked_add(points)
            .ok_or(SessionDataError::InvalidManifestPlot("point limit"))?;
        self.labels = self
            .labels
            .checked_add(labels)
            .ok_or(SessionDataError::InvalidManifestPlot("label limit"))?;
        if sticks {
            self.sticks_points = self
                .sticks_points
                .checked_add(points)
                .ok_or(SessionDataError::InvalidManifestPlot("stick point limit"))?;
        }
        if self.series > MAX_PLOT_SERIES {
            return Err(SessionDataError::InvalidManifestPlot("too many series"));
        }
        if self.points > MAX_PLOT_POINTS {
            return Err(SessionDataError::InvalidManifestPlot("too many points"));
        }
        if self.sticks_points > MAX_PLOT_STICKS_POINTS {
            return Err(SessionDataError::InvalidManifestPlot(
                "too many sticks points",
            ));
        }
        if self.labels > MAX_PLOT_LABELS {
            return Err(SessionDataError::InvalidManifestPlot("too many labels"));
        }
        Ok(())
    }

    // V2 scene data is admitted by the shared memory budget. Keep only
    // checked accounting here so malformed numeric totals cannot wrap.
    fn add_series_v2(&mut self, points: usize) -> Result<(), SessionDataError> {
        self.series = self
            .series
            .checked_add(1)
            .ok_or(SessionDataError::InvalidManifestPlot("series limit"))?;
        self.points = self
            .points
            .checked_add(points)
            .ok_or(SessionDataError::InvalidManifestPlot("point limit"))?;
        Ok(())
    }
}

fn validate_manifest_plot(
    manifest: &serde_json::Map<String, Value>,
) -> Result<(), SessionDataError> {
    let Some(plot) = manifest.get("plot") else {
        return Ok(());
    };
    let plot = plot
        .as_object()
        .ok_or(SessionDataError::InvalidManifestPlot(
            "root must be an object",
        ))?;
    if plot.get("format").and_then(Value::as_str) != Some(PLOT_FORMAT)
        || !matches!(
            plot.get("version").and_then(Value::as_u64),
            Some(PLOT_VERSION) | Some(PLOT_V2_VERSION)
        )
    {
        return Err(SessionDataError::InvalidManifestPlot(
            "unsupported format or version",
        ));
    }
    let version = plot.get("version").and_then(Value::as_u64).unwrap();
    if version == PLOT_VERSION {
        let kind = plot
            .get("kind")
            .and_then(Value::as_str)
            .ok_or(SessionDataError::InvalidManifestPlot("kind"))?;
        if !matches!(kind, "dos" | "ir" | "raman" | "uvvis" | "nmr") {
            return Err(SessionDataError::InvalidManifestPlot("kind"));
        }
    } else {
        if let Some(kind) = plot.get("semanticKind").or_else(|| plot.get("kind")) {
            require_non_empty_value_string(kind)?;
        }
        let page = plot
            .get("page")
            .and_then(Value::as_object)
            .ok_or(SessionDataError::InvalidManifestPlot("page"))?;
        for field in ["width", "height"] {
            if !page
                .get(field)
                .and_then(Value::as_f64)
                .is_some_and(|value| value.is_finite() && value > 0.0)
            {
                return Err(SessionDataError::InvalidManifestPlot("page"));
            }
        }
    }
    require_non_empty_string(plot, "title")?;
    let panels = plot
        .get("panels")
        .and_then(Value::as_array)
        .filter(|panels| !panels.is_empty())
        .ok_or(SessionDataError::InvalidManifestPlot("panels"))?;

    let mut limits = PlotLimits::default();
    let mut panel_ids = std::collections::HashSet::new();
    for panel in panels {
        let panel_id = panel
            .as_object()
            .and_then(|item| item.get("id"))
            .and_then(Value::as_str)
            .ok_or(SessionDataError::InvalidManifestPlot("panel id"))?;
        if !panel_ids.insert(panel_id) {
            return Err(SessionDataError::InvalidManifestPlot("duplicate panel id"));
        }
        if version == PLOT_V2_VERSION {
            validate_plot_panel_v2(panel, &mut limits)?;
        } else {
            validate_plot_panel(panel, &mut limits)?;
        }
    }
    Ok(())
}

fn validate_plot_panel_v2(value: &Value, limits: &mut PlotLimits) -> Result<(), SessionDataError> {
    let panel = value
        .as_object()
        .ok_or(SessionDataError::InvalidManifestPlot("panel"))?;
    require_non_empty_string(panel, "id")?;
    let viewport = panel
        .get("viewport")
        .and_then(Value::as_array)
        .filter(|items| items.len() == 4)
        .ok_or(SessionDataError::InvalidManifestPlot("viewport"))?;
    let viewport_values: Vec<f64> = viewport
        .iter()
        .map(|item| {
            item.as_f64()
                .filter(|value| value.is_finite())
                .ok_or(SessionDataError::InvalidManifestPlot("viewport"))
        })
        .collect::<Result<_, _>>()?;
    if viewport_values[0] < 0.0
        || viewport_values[1] < 0.0
        || viewport_values[2] <= 0.0
        || viewport_values[3] <= 0.0
        || viewport_values[0] + viewport_values[2] > 1.0
        || viewport_values[1] + viewport_values[3] > 1.0
    {
        return Err(SessionDataError::InvalidManifestPlot("viewport"));
    }
    let axes = panel
        .get("axes")
        .and_then(Value::as_object)
        .ok_or(SessionDataError::InvalidManifestPlot("axes"))?;
    validate_plot_scene_axis(axes.get("x1"))?;
    validate_plot_scene_axis(axes.get("y1"))?;
    if let Some(axis) = axes.get("x2") {
        validate_plot_scene_axis(Some(axis))?;
    }
    if let Some(axis) = axes.get("y2") {
        validate_plot_scene_axis(Some(axis))?;
    }
    let layers = panel
        .get("layers")
        .and_then(Value::as_array)
        .filter(|items| !items.is_empty())
        .ok_or(SessionDataError::InvalidManifestPlot("layers"))?;
    let mut layer_ids = std::collections::HashSet::new();
    for layer in layers {
        let layer = layer
            .as_object()
            .ok_or(SessionDataError::InvalidManifestPlot("layer"))?;
        require_non_empty_string(layer, "id")?;
        let id = layer.get("id").and_then(Value::as_str).unwrap();
        if !layer_ids.insert(id) {
            return Err(SessionDataError::InvalidManifestPlot("duplicate layer id"));
        }
        let kind = layer
            .get("type")
            .and_then(Value::as_str)
            .ok_or(SessionDataError::InvalidManifestPlot("layer type"))?;
        if !matches!(
            kind,
            "line" | "scatter" | "line+scatter" | "bars" | "error-bars" | "fill" | "contour"
        ) {
            return Err(SessionDataError::InvalidManifestPlot("layer type"));
        }
        if let Some(axis) = layer.get("xAxis") {
            if !matches!(axis.as_str(), Some("x1" | "x2")) {
                return Err(SessionDataError::InvalidManifestPlot("layer axis"));
            }
            if axis.as_str() == Some("x2") && !axes.contains_key("x2") {
                return Err(SessionDataError::InvalidManifestPlot("missing x2 axis"));
            }
        }
        if let Some(axis) = layer.get("yAxis") {
            if !matches!(axis.as_str(), Some("y1" | "y2")) {
                return Err(SessionDataError::InvalidManifestPlot("layer axis"));
            }
            if axis.as_str() == Some("y2") && !axes.contains_key("y2") {
                return Err(SessionDataError::InvalidManifestPlot("missing y2 axis"));
            }
        }
        let has_dataset = layer
            .get("data")
            .and_then(Value::as_object)
            .and_then(|data| data.get("datasetId"))
            .and_then(Value::as_u64)
            .is_some_and(|id| id > 0);
        if !has_dataset {
            return Err(SessionDataError::InvalidManifestPlot("dataset reference"));
        }
        if kind == "contour" {
            let shape = layer
                .get("shape")
                .and_then(Value::as_array)
                .filter(|items| items.len() == 2)
                .ok_or(SessionDataError::InvalidManifestPlot("layer dimensions"))?;
            if shape
                .iter()
                .any(|item| item.as_u64().is_none_or(|value| value < 2))
            {
                return Err(SessionDataError::InvalidManifestPlot("layer dimensions"));
            }
            if layer.get("order").and_then(Value::as_str) != Some("x-fastest") {
                return Err(SessionDataError::InvalidManifestPlot("layer order"));
            }
        }
        if let Some(filled) = layer.get("filled") {
            if kind != "contour" || filled.as_bool() != Some(false) {
                return Err(SessionDataError::InvalidManifestPlot("filled contour"));
            }
        }
        let points = layer
            .get("count")
            .and_then(Value::as_u64)
            .or_else(|| {
                layer
                    .get("shape")
                    .and_then(Value::as_array)
                    .and_then(|shape| {
                        shape
                            .iter()
                            .try_fold(1_u64, |total, item| total.checked_mul(item.as_u64()?))
                    })
            })
            .unwrap_or(1);
        if points == 0 || points > usize::MAX as u64 {
            return Err(SessionDataError::InvalidManifestPlot("layer count"));
        }
        limits.add_series_v2(points as usize)?;
    }
    Ok(())
}

fn validate_plot_scene_axis(value: Option<&Value>) -> Result<(), SessionDataError> {
    let axis = value
        .and_then(Value::as_object)
        .ok_or(SessionDataError::InvalidManifestPlot("axis"))?;
    require_non_empty_string(axis, "label")?;
    let range = axis
        .get("range")
        .and_then(Value::as_array)
        .filter(|items| items.len() == 2)
        .ok_or(SessionDataError::InvalidManifestPlot("axis range"))?;
    let values: Vec<f64> = range
        .iter()
        .map(|item| {
            item.as_f64()
                .filter(|value| value.is_finite())
                .ok_or(SessionDataError::InvalidManifestPlot("axis range"))
        })
        .collect::<Result<_, _>>()?;
    if values[0] == values[1] {
        return Err(SessionDataError::InvalidManifestPlot("axis range"));
    }
    let scale = axis
        .get("scale")
        .and_then(Value::as_str)
        .unwrap_or("linear");
    if !matches!(scale, "linear" | "log")
        || (scale == "log" && values.iter().any(|value| *value <= 0.0))
    {
        return Err(SessionDataError::InvalidManifestPlot("axis scale"));
    }
    Ok(())
}

fn validate_plot_panel(value: &Value, limits: &mut PlotLimits) -> Result<(), SessionDataError> {
    let panel = value
        .as_object()
        .ok_or(SessionDataError::InvalidManifestPlot("panel"))?;
    require_non_empty_string(panel, "id")?;
    if let Some(title) = panel.get("title") {
        require_non_empty_value_string(title)?;
    }
    if let Some(height_weight) = panel.get("heightWeight") {
        require_finite_number(height_weight)?;
    }
    validate_plot_axis(panel.get("xAxis"))?;
    validate_plot_axis(panel.get("yAxis"))?;
    if let Some(y2_axis) = panel.get("y2Axis") {
        validate_plot_axis(Some(y2_axis))?;
    }
    let series = panel
        .get("series")
        .and_then(Value::as_array)
        .filter(|series| !series.is_empty())
        .ok_or(SessionDataError::InvalidManifestPlot("series"))?;
    for item in series {
        validate_plot_series(item, limits)?;
    }
    if let Some(references) = panel.get("referenceLines") {
        let references = references
            .as_array()
            .ok_or(SessionDataError::InvalidManifestPlot("referenceLines"))?;
        for reference in references {
            validate_plot_reference_line(reference)?;
        }
    }
    Ok(())
}

fn validate_plot_axis(value: Option<&Value>) -> Result<(), SessionDataError> {
    let axis = value
        .and_then(Value::as_object)
        .ok_or(SessionDataError::InvalidManifestPlot("axis"))?;
    require_non_empty_string(axis, "label")?;
    if let Some(unit) = axis.get("unit") {
        require_non_empty_value_string(unit)?;
    }
    let range = axis
        .get("range")
        .and_then(Value::as_array)
        .filter(|range| range.len() == 2)
        .ok_or(SessionDataError::InvalidManifestPlot("axis range"))?;
    for bound in range {
        require_finite_number(bound)?;
    }
    Ok(())
}

fn validate_plot_series(value: &Value, limits: &mut PlotLimits) -> Result<(), SessionDataError> {
    let series = value
        .as_object()
        .ok_or(SessionDataError::InvalidManifestPlot("series item"))?;
    let series_type = series
        .get("type")
        .and_then(Value::as_str)
        .filter(|series_type| matches!(*series_type, "line" | "sticks"))
        .ok_or(SessionDataError::InvalidManifestPlot("series type"))?;
    require_non_empty_string(series, "id")?;
    for field in ["label", "color"] {
        if let Some(value) = series.get(field) {
            require_non_empty_value_string(value)?;
        }
    }
    if let Some(axis) = series.get("axis") {
        if !matches!(axis.as_str(), Some("y" | "y2")) {
            return Err(SessionDataError::InvalidManifestPlot("series axis"));
        }
    }
    if let Some(line_width) = series.get("lineWidth") {
        require_finite_number(line_width)?;
    }
    if let Some(dash) = series.get("dash") {
        if !matches!(dash.as_str(), Some("solid" | "dash")) {
            return Err(SessionDataError::InvalidManifestPlot("series dash"));
        }
    }
    if let Some(visible) = series.get("visible") {
        if !visible.is_boolean() {
            return Err(SessionDataError::InvalidManifestPlot("series visible"));
        }
    }
    let x = finite_number_array(series.get("x"))?;
    let y = finite_number_array(series.get("y"))?;
    if x.len() != y.len() {
        return Err(SessionDataError::InvalidManifestPlot("series x/y lengths"));
    }
    let mut non_null_labels = 0;
    if let Some(labels) = series.get("labels") {
        let labels = labels
            .as_array()
            .filter(|labels| labels.len() == x.len())
            .ok_or(SessionDataError::InvalidManifestPlot("series labels"))?;
        for label in labels {
            if !label.is_null() {
                require_non_empty_value_string(label)?;
                non_null_labels += 1;
            }
        }
    }
    limits.add_series(x.len(), series_type == "sticks", non_null_labels)
}

fn validate_plot_reference_line(value: &Value) -> Result<(), SessionDataError> {
    let reference = value
        .as_object()
        .ok_or(SessionDataError::InvalidManifestPlot("reference line"))?;
    if !matches!(
        reference.get("axis").and_then(Value::as_str),
        Some("x" | "y" | "y2")
    ) {
        return Err(SessionDataError::InvalidManifestPlot("reference line axis"));
    }
    require_finite_number(
        reference
            .get("value")
            .ok_or(SessionDataError::InvalidManifestPlot(
                "reference line value",
            ))?,
    )?;
    for field in ["label", "color"] {
        if let Some(value) = reference.get(field) {
            require_non_empty_value_string(value)?;
        }
    }
    if let Some(dash) = reference.get("dash") {
        if !matches!(dash.as_str(), Some("solid" | "dash")) {
            return Err(SessionDataError::InvalidManifestPlot("reference line dash"));
        }
    }
    Ok(())
}

fn finite_number_array(value: Option<&Value>) -> Result<&[Value], SessionDataError> {
    let values = value
        .and_then(Value::as_array)
        .filter(|values| !values.is_empty())
        .ok_or(SessionDataError::InvalidManifestPlot("number array"))?;
    for value in values {
        require_finite_number(value)?;
    }
    Ok(values)
}

fn require_finite_number(value: &Value) -> Result<(), SessionDataError> {
    if value.as_f64().is_some_and(|value| value.is_finite()) {
        Ok(())
    } else {
        Err(SessionDataError::InvalidManifestPlot("finite number"))
    }
}

fn require_non_empty_string(
    object: &serde_json::Map<String, Value>,
    field: &'static str,
) -> Result<(), SessionDataError> {
    let value = object
        .get(field)
        .ok_or(SessionDataError::InvalidManifestPlot(field))?;
    require_non_empty_value_string(value)
}

fn require_non_empty_value_string(value: &Value) -> Result<(), SessionDataError> {
    if value.as_str().is_some_and(|value| !value.is_empty()) {
        Ok(())
    } else {
        Err(SessionDataError::InvalidManifestPlot("string"))
    }
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

    fn valid_plot() -> Value {
        json!({
            "format": PLOT_FORMAT,
            "version": PLOT_VERSION,
            "kind": "dos",
            "title": "Density of states",
            "panels": [{
                "id": "total",
                "xAxis": {"label": "Energy", "range": [-5.0, 5.0]},
                "yAxis": {"label": "DOS", "range": [0.0, 10.0]},
                "y2Axis": {"label": "Projected", "unit": "arb.", "range": [10.0, 0.0]},
                "series": [{
                    "id": "up",
                    "label": "Spin up",
                    "type": "sticks",
                    "x": [-1.0, 1.0],
                    "y": [2.0, 4.0],
                    "labels": ["left", null]
                }]
            }]
        })
    }

    fn valid_plot_v2() -> Value {
        json!({
            "format": PLOT_FORMAT,
            "version": PLOT_V2_VERSION,
            "title": "Generic scene",
            "page": {"width": 1600.0, "height": 900.0},
            "panels": [{
                "id": "main",
                "viewport": [0.0, 0.0, 1.0, 1.0],
                "axes": {
                    "x1": {"label": "X", "range": [0.0, 1.0]},
                    "y1": {"label": "Y", "range": [0.0, 1.0]}
                },
                "layers": [{
                    "id": "line",
                    "type": "line",
                    "data": {"datasetId": 1},
                    "count": 1
                }]
            }]
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

    #[test]
    fn accepts_a_valid_inline_plot() {
        let mut body = valid_body();
        body["manifest"]["plot"] = valid_plot();
        assert!(SessionData::parse(&frame(body)).is_ok());
    }

    #[test]
    fn rejects_malformed_inline_plot() {
        let mut wrong_version = valid_body();
        wrong_version["manifest"]["plot"] = valid_plot();
        wrong_version["manifest"]["plot"]["version"] = json!(3);
        assert!(matches!(
            SessionData::parse(&frame(wrong_version)),
            Err(SessionDataError::InvalidManifestPlot(
                "unsupported format or version"
            ))
        ));

        let mut nonfinite = valid_body();
        nonfinite["manifest"]["plot"] = valid_plot();
        nonfinite["manifest"]["plot"]["panels"][0]["series"][0]["y"][0] = Value::Null;
        assert!(matches!(
            SessionData::parse(&frame(nonfinite)),
            Err(SessionDataError::InvalidManifestPlot("finite number"))
        ));

        let mut mismatched = valid_body();
        mismatched["manifest"]["plot"] = valid_plot();
        mismatched["manifest"]["plot"]["panels"][0]["series"][0]["y"] = json!([2.0]);
        assert!(matches!(
            SessionData::parse(&frame(mismatched)),
            Err(SessionDataError::InvalidManifestPlot("series x/y lengths"))
        ));
    }

    #[test]
    fn accepts_v2_counts_above_legacy_point_limit() {
        let mut body = valid_body();
        body["manifest"]["plot"] = valid_plot_v2();
        body["manifest"]["plot"]["panels"][0]["layers"][0]["count"] = json!(2_000_001_u64);
        assert!(SessionData::parse(&frame(body)).is_ok());
    }

    #[test]
    fn rejects_v2_annotation_and_invalid_secondary_axes() {
        let mut annotation = valid_body();
        annotation["manifest"]["plot"] = valid_plot_v2();
        annotation["manifest"]["plot"]["panels"][0]["layers"][0]["type"] = json!("annotation");
        assert!(matches!(
            SessionData::parse(&frame(annotation)),
            Err(SessionDataError::InvalidManifestPlot("layer type"))
        ));

        for (field, value) in [("xAxis", "y1"), ("yAxis", "x1")] {
            let mut invalid = valid_body();
            invalid["manifest"]["plot"] = valid_plot_v2();
            invalid["manifest"]["plot"]["panels"][0]["layers"][0][field] = json!(value);
            assert!(matches!(
                SessionData::parse(&frame(invalid)),
                Err(SessionDataError::InvalidManifestPlot("layer axis"))
            ));
        }

        for field in ["xAxis", "yAxis"] {
            let mut missing = valid_body();
            missing["manifest"]["plot"] = valid_plot_v2();
            missing["manifest"]["plot"]["panels"][0]["layers"][0][field] =
                json!(if field == "xAxis" { "x2" } else { "y2" });
            let expected = if field == "xAxis" {
                "missing x2 axis"
            } else {
                "missing y2 axis"
            };
            assert_eq!(
                SessionData::parse(&frame(missing)),
                Err(SessionDataError::InvalidManifestPlot(expected))
            );
        }
    }

    #[test]
    fn enforces_inline_plot_limits_without_large_allocations() {
        let mut series = PlotLimits::default();
        for _ in 0..MAX_PLOT_SERIES {
            series.add_series(0, false, 0).unwrap();
        }
        assert_eq!(
            series.add_series(0, false, 0),
            Err(SessionDataError::InvalidManifestPlot("too many series"))
        );

        let mut points = PlotLimits::default();
        points.add_series(MAX_PLOT_POINTS, false, 0).unwrap();
        assert_eq!(
            points.add_series(1, false, 0),
            Err(SessionDataError::InvalidManifestPlot("too many points"))
        );

        let mut sticks = PlotLimits::default();
        sticks.add_series(MAX_PLOT_STICKS_POINTS, true, 0).unwrap();
        assert_eq!(
            sticks.add_series(1, true, 0),
            Err(SessionDataError::InvalidManifestPlot(
                "too many sticks points"
            ))
        );

        let mut labels = PlotLimits::default();
        labels
            .add_series(MAX_PLOT_LABELS, false, MAX_PLOT_LABELS)
            .unwrap();
        assert_eq!(
            labels.add_series(1, false, 1),
            Err(SessionDataError::InvalidManifestPlot("too many labels"))
        );
    }
}
