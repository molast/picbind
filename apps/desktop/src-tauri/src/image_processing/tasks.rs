use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use picbind_image_native::NativeTaskControl;

#[derive(Clone, Default)]
pub struct NativeImageTasks {
    active: Arc<Mutex<HashMap<String, NativeTaskControl>>>,
}

impl NativeImageTasks {
    pub fn start(&self, request_id: String) -> Result<NativeTaskRegistration, String> {
        validate_request_id(&request_id)?;
        let control = NativeTaskControl::default();
        let mut active = self.active.lock().map_err(|error| error.to_string())?;
        if active.contains_key(&request_id) {
            return Err("An image task with this requestId is already active".to_string());
        }
        active.insert(request_id.clone(), control.clone());
        Ok(NativeTaskRegistration {
            request_id,
            control,
            tasks: self.clone(),
        })
    }

    pub fn cancel(&self, request_id: &str) -> Result<bool, String> {
        validate_request_id(request_id)?;
        let active = self.active.lock().map_err(|error| error.to_string())?;
        if let Some(control) = active.get(request_id) {
            control.cancel();
            Ok(true)
        } else {
            Ok(false)
        }
    }

    fn finish(&self, request_id: &str) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(request_id);
        }
    }

    #[cfg(test)]
    fn active_count(&self) -> usize {
        self.active.lock().map_or(0, |active| active.len())
    }
}

pub struct NativeTaskRegistration {
    request_id: String,
    control: NativeTaskControl,
    tasks: NativeImageTasks,
}

impl NativeTaskRegistration {
    pub fn control(&self) -> &NativeTaskControl {
        &self.control
    }
}

impl Drop for NativeTaskRegistration {
    fn drop(&mut self) {
        self.tasks.finish(&self.request_id);
    }
}

fn validate_request_id(request_id: &str) -> Result<(), String> {
    if request_id.is_empty() || request_id.len() > 256 || request_id.chars().any(char::is_control) {
        return Err("Image task requestId is invalid".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registration_is_unique_and_removed_on_drop() {
        let tasks = NativeImageTasks::default();
        let registration = tasks.start("request:1".into()).unwrap();
        assert!(tasks.start("request:1".into()).is_err());
        assert_eq!(tasks.active_count(), 1);
        drop(registration);
        assert_eq!(tasks.active_count(), 0);
    }

    #[test]
    fn cancellation_reaches_the_registered_control() {
        let tasks = NativeImageTasks::default();
        let registration = tasks.start("request:2".into()).unwrap();
        assert!(tasks.cancel("request:2").unwrap());
        assert!(registration.control().is_cancelled());
    }
}
