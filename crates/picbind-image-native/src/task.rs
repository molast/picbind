use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use crate::NativeImageError;

#[derive(Clone, Debug, Default)]
pub struct NativeTaskControl {
    cancelled: Arc<AtomicBool>,
}

impl NativeTaskControl {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub fn checkpoint(&self) -> Result<(), NativeImageError> {
        if self.is_cancelled() {
            Err(NativeImageError::Cancelled)
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancelled_control_fails_future_checkpoints() {
        let control = NativeTaskControl::default();
        assert!(control.checkpoint().is_ok());
        control.cancel();
        assert_eq!(control.checkpoint(), Err(NativeImageError::Cancelled));
    }
}
