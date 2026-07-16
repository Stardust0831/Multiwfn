use std::collections::hash_map::Entry;
use std::collections::HashMap;
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::Mutex;

use crate::volume_protocol::{StreamVolumeHeader, VOLUME_HEADER_BYTES};

const CHANNEL_CHUNKS: usize = 8;

#[derive(Debug)]
pub enum StreamEvent {
    Begin(Box<StreamVolumeHeader>, Box<[u8; VOLUME_HEADER_BYTES]>),
    Chunk(Vec<u8>),
    End,
    Error(String),
}

pub struct StreamRegistration<'a> {
    request_id: u64,
    broker: &'a VolumeStreamBroker,
    receiver: Receiver<StreamEvent>,
}

impl StreamRegistration<'_> {
    pub fn receiver(&self) -> &Receiver<StreamEvent> {
        &self.receiver
    }
}

impl Drop for StreamRegistration<'_> {
    fn drop(&mut self) {
        self.broker.cancel(self.request_id);
    }
}

#[derive(Default)]
pub struct VolumeStreamBroker {
    pending: Mutex<HashMap<u64, SyncSender<StreamEvent>>>,
}

impl VolumeStreamBroker {
    pub fn register(&self, request_id: u64) -> Result<StreamRegistration<'_>, String> {
        if request_id == 0 {
            return Err("stream request ID must be nonzero".to_owned());
        }
        let (sender, receiver) = mpsc::sync_channel(CHANNEL_CHUNKS);
        let mut pending = self.pending.lock().expect("stream broker lock");
        match pending.entry(request_id) {
            Entry::Occupied(_) => {
                return Err("stream request ID is already registered".to_owned());
            }
            Entry::Vacant(entry) => {
                entry.insert(sender);
            }
        }
        Ok(StreamRegistration {
            request_id,
            broker: self,
            receiver,
        })
    }

    pub fn sender(&self, request_id: u64) -> Option<SyncSender<StreamEvent>> {
        self.pending
            .lock()
            .expect("stream broker lock")
            .get(&request_id)
            .cloned()
    }

    pub fn finish(&self, request_id: u64) {
        self.pending
            .lock()
            .expect("stream broker lock")
            .remove(&request_id);
    }

    pub fn fail_all(&self, message: &str) {
        let senders = self
            .pending
            .lock()
            .expect("stream broker lock")
            .drain()
            .map(|(_, sender)| sender)
            .collect::<Vec<_>>();
        for sender in senders {
            match sender.try_send(StreamEvent::Error(message.to_owned())) {
                Ok(()) | Err(TrySendError::Disconnected(_)) | Err(TrySendError::Full(_)) => {}
            }
        }
    }

    fn cancel(&self, request_id: u64) {
        self.finish(request_id);
    }
}

#[cfg(test)]
mod tests {
    use super::{StreamEvent, VolumeStreamBroker};

    #[test]
    fn registration_is_unique_and_drop_cancels_delivery() {
        let broker = VolumeStreamBroker::default();
        let registration = broker.register(7).unwrap();
        assert!(broker.register(7).is_err());
        broker.sender(7).unwrap().send(StreamEvent::End).unwrap();
        assert!(matches!(
            registration.receiver().recv().unwrap(),
            StreamEvent::End
        ));
        drop(registration);
        assert!(broker.sender(7).is_none());
    }
}
