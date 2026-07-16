use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::volume_protocol::{decode_volume, VolumeError};

pub const MAX_ENTRIES: usize = 8;
pub const MAX_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InsertError {
    InvalidFrame(VolumeError),
    DuplicateVolumeId,
    FrameTooLarge,
}

impl std::fmt::Display for InsertError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidFrame(error) => write!(f, "invalid volume frame: {error}"),
            Self::DuplicateVolumeId => f.write_str("duplicate volume ID"),
            Self::FrameTooLarge => f.write_str("volume frame exceeds store byte limit"),
        }
    }
}

impl std::error::Error for InsertError {}

struct Entry {
    frame: Arc<[u8]>,
    last_read: u64,
}

struct State {
    entries: HashMap<u64, Entry>,
    bytes: usize,
    clock: u64,
}

pub struct VolumeStore {
    state: Mutex<State>,
    max_entries: usize,
    max_bytes: usize,
}

impl Default for VolumeStore {
    fn default() -> Self {
        Self::new()
    }
}

impl VolumeStore {
    pub fn new() -> Self {
        Self::with_limits(MAX_ENTRIES, MAX_BYTES)
    }

    fn with_limits(max_entries: usize, max_bytes: usize) -> Self {
        Self {
            state: Mutex::new(State {
                entries: HashMap::new(),
                bytes: 0,
                clock: 0,
            }),
            max_entries,
            max_bytes,
        }
    }

    pub fn insert<B>(&self, frame: B) -> Result<u64, InsertError>
    where
        B: Into<Arc<[u8]>>,
    {
        let frame = frame.into();
        let volume = decode_volume(&frame).map_err(InsertError::InvalidFrame)?;
        let volume_id = volume.volume_id;
        if frame.len() > self.max_bytes {
            return Err(InsertError::FrameTooLarge);
        }

        let mut state = self.state.lock().expect("volume store lock");
        if state.entries.contains_key(&volume_id) {
            return Err(InsertError::DuplicateVolumeId);
        }
        state.clock = state.clock.wrapping_add(1);
        let last_read = state.clock;
        state.bytes += frame.len();
        state.entries.insert(volume_id, Entry { frame, last_read });
        while state.entries.len() > self.max_entries || state.bytes > self.max_bytes {
            let evicted = state
                .entries
                .iter()
                .min_by_key(|(id, entry)| (entry.last_read, **id))
                .map(|(id, _)| *id)
                .expect("store bounds require an entry");
            let entry = state
                .entries
                .remove(&evicted)
                .expect("entry selected above");
            state.bytes -= entry.frame.len();
        }
        Ok(volume_id)
    }

    pub fn get(&self, volume_id: u64) -> Option<Arc<[u8]>> {
        let mut state = self.state.lock().expect("volume store lock");
        let clock = state.clock.wrapping_add(1);
        state.clock = clock;
        state.entries.get_mut(&volume_id).map(|entry| {
            entry.last_read = clock;
            Arc::clone(&entry.frame)
        })
    }

    pub fn clear(&self) {
        let mut state = self.state.lock().expect("volume store lock");
        state.entries.clear();
        state.bytes = 0;
    }

    pub fn len(&self) -> usize {
        self.state.lock().expect("volume store lock").entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn bytes(&self) -> usize {
        self.state.lock().expect("volume store lock").bytes
    }
}

#[cfg(test)]
mod tests {
    use super::{InsertError, VolumeStore, MAX_BYTES, MAX_ENTRIES};
    use crate::volume_protocol::{decode_volume, encode_volume};

    fn fixture() -> Vec<u8> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/fixtures/matterviz-volume-v1-orbital.hex"
        );
        let text = std::fs::read_to_string(path).expect("golden volume fixture");
        text.lines()
            .flat_map(|line| line.split('#').next().unwrap_or("").split_whitespace())
            .flat_map(|word| {
                (0..word.len()).step_by(2).map(move |index| {
                    u8::from_str_radix(&word[index..index + 2], 16).expect("hex byte")
                })
            })
            .collect()
    }

    fn frame(id: u64) -> Vec<u8> {
        let mut volume = decode_volume(&fixture()).unwrap();
        volume.volume_id = id;
        encode_volume(&volume).unwrap()
    }

    #[test]
    fn validates_and_rejects_duplicates() {
        let store = VolumeStore::new();
        let bytes = fixture();
        assert_eq!(store.insert(bytes.clone()).unwrap(), 1001);
        assert_eq!(store.get(1001).unwrap().as_ref(), bytes.as_slice());
        assert_eq!(store.insert(bytes), Err(InsertError::DuplicateVolumeId));
    }

    #[test]
    fn evicts_least_recently_read_and_clears() {
        let store = VolumeStore::new();
        for id in 1..=(MAX_ENTRIES as u64) {
            store.insert(frame(id)).unwrap();
        }
        assert!(store.get(1).is_some());
        store.insert(frame(9)).unwrap();
        assert!(store.get(2).is_none());
        assert!(store.get(1).is_some());
        assert_eq!(store.len(), MAX_ENTRIES);
        assert!(store.bytes() <= MAX_BYTES);
        store.clear();
        assert!(store.is_empty());
        assert_eq!(store.bytes(), 0);
    }

    #[test]
    fn evicts_to_the_byte_bound() {
        let sample = frame(1);
        let store = VolumeStore::with_limits(MAX_ENTRIES, sample.len() * 2);
        store.insert(sample.clone()).unwrap();
        store.insert(frame(2)).unwrap();
        assert_eq!(store.len(), 2);
        store.insert(frame(3)).unwrap();
        assert_eq!(store.len(), 2);
        assert!(store.get(1).is_none());
        assert!(store.bytes() <= sample.len() * 2);
    }
}
