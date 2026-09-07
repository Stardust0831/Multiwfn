use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::plot_protocol::{validate, PlotError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InsertError {
    InvalidFrame(PlotError),
    DuplicateDatasetId,
    FrameTooLarge,
}

impl std::fmt::Display for InsertError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidFrame(error) => write!(f, "invalid plot data frame: {error}"),
            Self::DuplicateDatasetId => f.write_str("duplicate plot dataset ID"),
            Self::FrameTooLarge => f.write_str("plot data frame exceeds store byte limit"),
        }
    }
}

impl std::error::Error for InsertError {}

struct Entry {
    frame: Arc<[u8]>,
}

struct State {
    entries: HashMap<u64, Entry>,
    bytes: usize,
    topology_id: Option<u64>,
    topology: Option<Value>,
    surface: Option<Value>,
}

pub struct PlotStore {
    state: Mutex<State>,
    max_bytes: usize,
}

impl Default for PlotStore {
    fn default() -> Self {
        Self::new()
    }
}

impl PlotStore {
    pub fn new() -> Self {
        Self::with_byte_limit(usize::MAX)
    }

    fn with_byte_limit(max_bytes: usize) -> Self {
        Self {
            state: Mutex::new(State {
                entries: HashMap::new(),
                bytes: 0,
                topology_id: None,
                topology: None,
                surface: None,
            }),
            max_bytes,
        }
    }

    pub fn insert<B>(&self, frame: B) -> Result<u64, InsertError>
    where
        B: Into<Arc<[u8]>>,
    {
        let frame = frame.into();
        let dataset_id = validate(&frame)
            .map_err(InsertError::InvalidFrame)?
            .dataset_id;
        if frame.len() > self.max_bytes {
            return Err(InsertError::FrameTooLarge);
        }
        let mut state = self.state.lock().expect("plot store lock");
        if state.entries.contains_key(&dataset_id) {
            return Err(InsertError::DuplicateDatasetId);
        }
        let new_bytes = state
            .bytes
            .checked_add(frame.len())
            .ok_or(InsertError::FrameTooLarge)?;
        if new_bytes > self.max_bytes {
            return Err(InsertError::FrameTooLarge);
        }
        state.bytes = new_bytes;
        state.entries.insert(dataset_id, Entry { frame });
        Ok(dataset_id)
    }

    pub fn get(&self, dataset_id: u64) -> Option<Arc<[u8]>> {
        let state = self.state.lock().expect("plot store lock");
        state
            .entries
            .get(&dataset_id)
            .map(|entry| Arc::clone(&entry.frame))
    }

    pub fn clear(&self) {
        let mut state = self.state.lock().expect("plot store lock");
        state.entries.clear();
        state.bytes = 0;
        state.topology_id = None;
        state.topology = None;
        state.surface = None;
    }

    pub fn ids(&self) -> Vec<u64> {
        self.state
            .lock()
            .expect("plot store lock")
            .entries
            .keys()
            .copied()
            .collect()
    }

    /// A topology replacement owns one dataset independently of ordinary plots.
    pub fn finish_topology(&self, before: &[u64], topology: Option<&Value>) {
        let mut state = self.state.lock().expect("plot store lock");
        let accepted = topology
            .and_then(|value| value.get("datasetId"))
            .and_then(Value::as_u64);
        let previous = state.topology_id;
        state.entries.retain(|id, _| {
            if Some(*id) == accepted {
                return true;
            }
            if accepted.is_some() && Some(*id) == previous {
                return false;
            }
            before.contains(id)
        });
        state.bytes = state.entries.values().map(|entry| entry.frame.len()).sum();
        if accepted.is_some() {
            state.topology_id = accepted.filter(|id| *id != 0);
            state.topology = topology.cloned();
        }
    }

    pub fn topology_metadata(&self) -> Option<Value> {
        self.state.lock().expect("plot store lock").topology.clone()
    }

    pub fn set_initial_topology(&self, id: u64) {
        self.state.lock().expect("plot store lock").topology_id = (id != 0).then_some(id);
    }

    pub fn set_initial_surface(&self, surface: &Value) {
        self.state.lock().expect("plot store lock").surface = Some(surface.clone());
    }

    pub fn surface_metadata(&self) -> Option<Value> {
        self.state.lock().expect("plot store lock").surface.clone()
    }

    /// Retire only the previous surface datasets, or discard a failed partial publication.
    pub fn finish_surface(&self, before: &[u64], surface: Option<&Value>) -> bool {
        let ids = |value: &Value| -> Vec<u64> {
            ["vertices", "facets", "extrema"]
                .iter()
                .filter_map(|key| value.get(key).and_then(Value::as_u64))
                .filter(|id| *id != 0)
                .collect()
        };
        let mut state = self.state.lock().expect("plot store lock");
        let surface = surface.filter(|value| {
            let all: Option<Vec<u64>> = ["vertices", "facets", "extrema"]
                .iter()
                .map(|key| value.get(key).and_then(Value::as_u64))
                .collect();
            all.is_some_and(|all| {
                all[0] > 0
                    && all[1] > 0
                    && all[0] != all[1]
                    && (all[2] == 0 || (all[2] != all[0] && all[2] != all[1]))
                    && all
                        .iter()
                        .filter(|id| **id != 0)
                        .all(|id| state.entries.contains_key(id) && !before.contains(id))
            })
        });
        let previous = state.surface.as_ref().map(ids).unwrap_or_default();
        let accepted = surface.map(ids).unwrap_or_default();
        state.entries.retain(|id, _| {
            accepted.contains(id)
                || (before.contains(id) && (surface.is_none() || !previous.contains(id)))
        });
        state.bytes = state.entries.values().map(|entry| entry.frame.len()).sum();
        if let Some(surface) = surface {
            state.surface = Some(surface.clone());
        }
        surface.is_some()
    }
    pub fn len(&self) -> usize {
        self.state.lock().expect("plot store lock").entries.len()
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
    pub fn bytes(&self) -> usize {
        self.state.lock().expect("plot store lock").bytes
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plot_protocol::{encode, PlotArray, PlotData, PlotRole};

    fn frame(id: u64) -> Vec<u8> {
        encode(&PlotData {
            dataset_id: id,
            arrays: vec![PlotArray {
                role: PlotRole::X,
                values: vec![1.0],
                body_offset: 0,
            }],
        })
        .unwrap()
    }

    #[test]
    fn topology_replacement_and_failure_keep_unrelated_plots_alive() {
        let store = PlotStore::new();
        store.insert(frame(1)).unwrap();
        store.insert(frame(2)).unwrap();
        store.set_initial_topology(2);
        let before = store.ids();
        store.insert(frame(3)).unwrap();
        store.finish_topology(&before, None);
        assert!(store.get(1).is_some() && store.get(2).is_some());
        assert!(store.get(3).is_none());
        store.insert(frame(4)).unwrap();
        store.finish_topology(&before, Some(&serde_json::json!({"datasetId": 4})));
        assert!(store.get(1).is_some() && store.get(4).is_some());
        assert!(store.get(2).is_none());
        assert_eq!(store.topology_metadata().unwrap()["datasetId"], 4);
        store.finish_topology(&store.ids(), Some(&serde_json::json!({"datasetId": 0})));
        assert_eq!(store.ids(), vec![1]);
        assert_eq!(store.bytes(), frame(1).len());
    }

    #[test]
    fn surface_replacement_failure_and_refresh_keep_other_datasets() {
        let store = PlotStore::new();
        for id in 1..=5 {
            store.insert(frame(id)).unwrap();
        }
        let original =
            serde_json::json!({"vertices": 2, "facets": 3, "extrema": 4, "mapped": null});
        store.set_initial_surface(&original);
        let before = store.ids();
        store.insert(frame(6)).unwrap();
        store.finish_surface(&before, None);
        assert!(store.get(6).is_none());
        assert_eq!(store.surface_metadata().unwrap(), original);
        store.insert(frame(6)).unwrap();
        assert!(!store.finish_surface(
            &before,
            Some(&serde_json::json!({"vertices":6,"facets":99,"extrema":0}))
        ));
        assert!(store.get(6).is_none());
        assert_eq!(store.surface_metadata().unwrap(), original);
        for id in 6..=8 {
            store.insert(frame(id)).unwrap();
        }
        let confirmed =
            serde_json::json!({"vertices": 6, "facets": 7, "extrema": 8, "mapped": true});
        store.finish_surface(&before, Some(&confirmed));
        for id in [1, 5, 6, 7, 8] {
            assert!(store.get(id).is_some());
        }
        for id in [2, 3, 4] {
            assert!(store.get(id).is_none());
        }
        assert_eq!(store.surface_metadata().unwrap(), confirmed);
        let before = store.ids();
        store.insert(frame(9)).unwrap();
        store.insert(frame(10)).unwrap();
        store.finish_surface(
            &before,
            Some(&serde_json::json!({"vertices": 9, "facets": 10, "extrema": 0, "mapped": false})),
        );
        assert!(store.get(8).is_none());
        assert_eq!(store.len(), 4);
        store.clear();
        assert!(store.surface_metadata().is_none());
    }

    #[test]
    fn rejects_duplicates_and_clears() {
        let store = PlotStore::new();
        let bytes = frame(1);
        assert_eq!(store.insert(bytes.clone()), Ok(1));
        assert_eq!(store.insert(bytes), Err(InsertError::DuplicateDatasetId));
        assert!(store.get(1).is_some());
        assert!(store.bytes() > 0);
        store.clear();
        assert!(store.is_empty());
        assert_eq!(store.bytes(), 0);
    }

    #[test]
    fn enforces_byte_limit_without_eviction() {
        let sample = frame(1);
        let store = PlotStore::with_byte_limit(sample.len() * 2);
        store.insert(sample).unwrap();
        store.insert(frame(2)).unwrap();
        assert!(store.get(1).is_some());
        assert!(store.get(2).is_some());
        assert_eq!(store.insert(frame(3)), Err(InsertError::FrameTooLarge));
        assert!(store.bytes() <= store.max_bytes);
    }

    #[test]
    fn retains_more_than_legacy_entry_limit() {
        let store = PlotStore::new();
        for id in 1..=129 {
            store.insert(frame(id)).unwrap();
        }
        assert_eq!(store.len(), 129);
        assert!(store.get(1).is_some());
    }
}
