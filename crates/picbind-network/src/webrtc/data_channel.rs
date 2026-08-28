use std::sync::Arc;

use tokio::sync::RwLock;
use webrtc::data_channel::{RTCDataChannel, data_channel_message::DataChannelMessage};

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
    control: RwLock<Option<Arc<RTCDataChannel>>>,
    bulk: RwLock<Option<Arc<RTCDataChannel>>>,
}

impl NativeDataChannels {
    pub async fn get(&self, channel: NativePeerChannel) -> Option<Arc<RTCDataChannel>> {
        match channel {
            NativePeerChannel::Control => self.control.read().await.clone(),
            NativePeerChannel::Bulk => self.bulk.read().await.clone(),
        }
    }

    async fn set(&self, channel: NativePeerChannel, value: Arc<RTCDataChannel>) {
        let target = match channel {
            NativePeerChannel::Control => &self.control,
            NativePeerChannel::Bulk => &self.bulk,
        };
        if let Some(previous) = target.write().await.replace(value)
            && let Err(error) = previous.close().await
        {
            let _ = error;
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
    data_channel: Arc<RTCDataChannel>,
    channels: Arc<NativeDataChannels>,
    events: NativeEventDispatcher,
) {
    let channel = match data_channel.label() {
        "workspace-control" => NativePeerChannel::Control,
        "workspace-bulk" => NativePeerChannel::Bulk,
        _ => {
            let _ = data_channel.close().await;
            return;
        }
    };

    let open_events = events.clone();
    data_channel.on_open(Box::new(move || {
        open_events.emit(NativePeerEventKind::ChannelState {
            channel,
            state: "open".into(),
        });
        Box::pin(async {})
    }));

    let close_events = events.clone();
    data_channel.on_close(Box::new(move || {
        close_events.emit(NativePeerEventKind::ChannelState {
            channel,
            state: "closed".into(),
        });
        Box::pin(async {})
    }));

    let message_events = events.clone();
    data_channel.on_message(Box::new(move |message: DataChannelMessage| {
        let kind = match decode_frame(message.is_string, &message.data) {
            Ok(frame) => NativePeerEventKind::Message { channel, frame },
            Err(error) => NativePeerEventKind::Error(error),
        };
        message_events.emit(kind);
        Box::pin(async {})
    }));

    let error_events = events;
    data_channel.on_error(Box::new(move |error| {
        error_events.emit(NativePeerEventKind::Error(error.to_string()));
        Box::pin(async {})
    }));

    channels.set(channel, data_channel).await;
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
