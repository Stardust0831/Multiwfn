use std::net::{SocketAddr, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

#[derive(Clone, Debug)]
pub struct ShutdownSignal {
    requested: Arc<AtomicBool>,
    wake_address: Option<SocketAddr>,
}

impl ShutdownSignal {
    pub fn new(wake_address: SocketAddr) -> Self {
        Self {
            requested: Arc::new(AtomicBool::new(false)),
            wake_address: Some(wake_address),
        }
    }

    #[cfg(test)]
    pub fn detached() -> Self {
        Self {
            requested: Arc::new(AtomicBool::new(false)),
            wake_address: None,
        }
    }

    pub fn is_requested(&self) -> bool {
        self.requested.load(Ordering::Acquire)
    }

    pub fn request(&self) {
        self.requested.store(true, Ordering::Release);
        if let Some(address) = self.wake_address {
            let _ = TcpStream::connect_timeout(&address, Duration::from_millis(100));
        }
    }

    pub fn flag(&self) -> &AtomicBool {
        &self.requested
    }
}

#[cfg(test)]
mod tests {
    use super::ShutdownSignal;
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn detached_shutdown_is_idempotent() {
        let shutdown = ShutdownSignal::detached();
        assert!(!shutdown.is_requested());
        shutdown.request();
        shutdown.request();
        assert!(shutdown.is_requested());
    }

    #[test]
    fn shutdown_wakes_the_listener() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let shutdown = ShutdownSignal::new(listener.local_addr().unwrap());
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let accepted = listener.accept().is_ok();
            let _ = sender.send(accepted);
        });

        shutdown.request();

        assert!(receiver.recv_timeout(Duration::from_secs(1)).unwrap());
        assert!(shutdown.is_requested());
    }
}
