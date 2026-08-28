use std::sync::Arc;

use tokio::sync::RwLock;
use webrtc::data_channel::{DataChannel, DataChannelEvent};

use super::{NativeEventDispatcher, NativeFrame, NativePeerChannel, NativePeerEventKind};

const MAXIMUM_TEXT_FRAME_BYTES: usize = 96 * 1024;
const MAXIMUM_BINARY_FRAME_BYTES: usize = 4 * 1024 * 1024;

fn decode_frame(is_string: bool, data: &[u8]) -> Result<NativeFrame, String> {
    if is_string {
        if data.len() > MAXIMUM_TEXT_FRAME_BYTES {
            return Err("native RTC text frame exceeds its size limit".into());
        }
        return String::from_utf8(data.to_vec())
            .map(NativeFrame::Text)
            .map_err(|_| "native RTC text frame is not valid UTF-8".into());
    }
    if data.len() > MAXIMUM_BINARY_FRAME_BYTES {
        return Err("native RTC binary frame exceeds its size limit".into());
    }
    Ok(NativeFrame::Binary(data.to_vec()))
}

#[derive(Default)]
pub struct NativeDataChannels {
    control: RwLock<Option<Arc<dyn DataChannel>>>,
    bulk: RwLock<Option<Arc<dyn DataChannel>>>,
}

impl NativeDataChannels {
    pub async fn get(&self, channel: NativePeerChannel) -> Option<Arc<dyn DataChannel>> {
        match channel {
            NativePeerChannel::Control => self.control.read().await.clone(),
            NativePeerChannel::Bulk => self.bulk.read().await.clone(),
        }
    }

    async fn set(&self, channel: NativePeerChannel, value: Arc<dyn DataChannel>) {
        let target = match channel {
            NativePeerChannel::Control => &self.control,
            NativePeerChannel::Bulk => &self.bulk,
        };
        let previous = target.write().await.replace(value);
        if let Some(previous) = previous {
            let _ = previous.close().await;
        }
    }

    async fn clear_if_current(&self, channel: NativePeerChannel, current: &Arc<dyn DataChannel>) {
        let target = match channel {
            NativePeerChannel::Control => &self.control,
            NativePeerChannel::Bulk => &self.bulk,
        };
        let mut value = target.write().await;
        if value
            .as_ref()
            .is_some_and(|value| Arc::ptr_eq(value, current))
        {
            value.take();
        }
    }

    pub async fn close(&self) {
        let control = self.control.write().await.take();
        let bulk = self.bulk.write().await.take();
        if let Some(channel) = control {
            let _ = channel.close().await;
        }
        if let Some(channel) = bulk {
            let _ = channel.close().await;
        }
    }
}

pub async fn attach_data_channel(
    data_channel: Arc<dyn DataChannel>,
    channels: Arc<NativeDataChannels>,
    events: NativeEventDispatcher,
) {
    let label = match data_channel.label().await {
        Ok(value) => value,
        Err(error) => {
            events.emit(NativePeerEventKind::Error(format!(
                "failed to read native RTC DataChannel label: {error}"
            )));
            let _ = data_channel.close().await;
            return;
        }
    };
    let channel = match label.as_str() {
        "workspace-control" => NativePeerChannel::Control,
        "workspace-bulk" => NativePeerChannel::Bulk,
        _ => {
            let _ = data_channel.close().await;
            return;
        }
    };

    match data_channel.ordered().await {
        Ok(true) => {}
        Ok(false) => {
            events.emit(NativePeerEventKind::Error(format!(
                "native RTC {} channel must be ordered",
                channel.as_str()
            )));
            let _ = data_channel.close().await;
            return;
        }
        Err(error) => {
            events.emit(NativePeerEventKind::Error(format!(
                "failed to inspect native RTC {} channel: {error}",
                channel.as_str()
            )));
            let _ = data_channel.close().await;
            return;
        }
    }

    channels.set(channel, data_channel.clone()).await;
    tokio::spawn(async move {
        let mut closed_emitted = false;
        while let Some(event) = data_channel.poll().await {
            match event {
                DataChannelEvent::OnOpen => {
                    events.emit(NativePeerEventKind::ChannelState {
                        channel,
                        state: "open".into(),
                    });
                }
                DataChannelEvent::OnMessage(message) => {
                    let kind = match decode_frame(message.is_string, &message.data) {
                        Ok(frame) => NativePeerEventKind::Message { channel, frame },
                        Err(error) => NativePeerEventKind::Error(error),
                    };
                    events.emit(kind);
                }
                DataChannelEvent::OnError => {
                    events.emit(NativePeerEventKind::Error(format!(
                        "native RTC {} channel reported an error",
                        channel.as_str()
                    )));
                }
                DataChannelEvent::OnClose => {
                    events.emit(NativePeerEventKind::ChannelState {
                        channel,
                        state: "closed".into(),
                    });
                    closed_emitted = true;
                    break;
                }
                DataChannelEvent::OnClosing
                | DataChannelEvent::OnBufferedAmountLow
                | DataChannelEvent::OnBufferedAmountHigh => {}
            }
        }
        if !closed_emitted {
            events.emit(NativePeerEventKind::ChannelState {
                channel,
                state: "closed".into(),
            });
        }
        channels.clear_if_current(channel, &data_channel).await;
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_utf8_text_frames() {
        assert!(decode_frame(true, &[0xff]).is_err());
    }

    #[test]
    fn rejects_oversized_binary_frames() {
        assert!(decode_frame(false, &vec![0; MAXIMUM_BINARY_FRAME_BYTES + 1]).is_err());
    }
}
