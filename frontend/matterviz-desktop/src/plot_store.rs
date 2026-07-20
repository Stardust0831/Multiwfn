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

    #[cfg(test)]
    fn with_byte_limit(max_bytes: usize) -> Self {
        Self {
            state: Mutex::new(State {
                entries: HashMap::new(),
                bytes: 0,
            }),
            max_bytes,
        }
    }

    #[cfg(not(test))]
    fn with_byte_limit(max_bytes: usize) -> Self {
        Self {
            state: Mutex::new(State {
                entries: HashMap::new(),
                bytes: 0,
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
