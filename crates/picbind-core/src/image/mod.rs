use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ImageCollaborationState {
    #[default]
    Private,
    Shared,
    Working,
    Reviewing,
    #[serde(alias = "updated")]
    Committed,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ImageStateEvent {
    Share,
    Unshare,
    StartWork,
    SubmitReview,
    Commit,
}

impl ImageCollaborationState {
    pub fn transition(self, event: ImageStateEvent) -> Result<Self, &'static str> {
        use ImageCollaborationState as S;
        use ImageStateEvent as E;
        match (self, event) {
            (S::Private, E::Share) => Ok(S::Shared),
            (S::Shared | S::Working | S::Reviewing | S::Committed, E::Unshare) => Ok(S::Private),
            (S::Shared | S::Committed, E::StartWork) => Ok(S::Working),
            (S::Working | S::Shared, E::SubmitReview) => Ok(S::Reviewing),
            (S::Reviewing | S::Working | S::Shared, E::Commit) => Ok(S::Committed),
            _ => Err("invalid image transition"),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewPlaceholder {
    pub width: u32,
    pub height: u32,
    pub dominant_color: String,
    pub blur_hash: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImagePreview {
    pub mime_type: String,
    pub width: u32,
    pub height: u32,
    pub bytes: Vec<u8>,
    pub placeholder: PreviewPlaceholder,
    pub revision: u64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceImage {
    pub image_id: String,
    pub workspace_id: String,
    pub name: String,
    pub mime_type: String,
    pub size: u64,
    pub width: u32,
    pub height: u32,
    pub state: ImageCollaborationState,
    #[serde(default)]
    pub shared: bool,
    pub current_commit_id: Option<String>,
    pub preview_revision: u64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl WorkspaceImage {
    // The constructor mirrors the persisted image record; keeping the fields explicit
    // avoids a second input type that can drift from the stored model.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        image_id: String,
        workspace_id: String,
        name: String,
        mime_type: String,
        size: u64,
        width: u32,
        height: u32,
        now: i64,
    ) -> Self {
        Self {
            image_id,
            workspace_id,
            name,
            mime_type,
            size,
            width,
            height,
            state: ImageCollaborationState::Private,
            shared: false,
            current_commit_id: None,
            preview_revision: 0,
            created_at: now,
            updated_at: now,
        }
    }
    pub fn can_publish_preview(&self) -> bool {
        self.shared
    }

    pub fn share(&mut self) {
        self.shared = true;
        if self.state == ImageCollaborationState::Private {
            self.state = ImageCollaborationState::Shared;
        }
    }

    pub fn unshare(&mut self) {
        self.shared = false;
        self.state = ImageCollaborationState::Private;
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRequest {
    pub request_id: String,
    pub workspace_id: String,
    pub image_id: String,
    pub requester_id: String,
    pub created_at: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceDecision {
    Accepted,
    Rejected { reason: String },
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn images_are_private_and_publish_no_preview_by_default() {
        let image = WorkspaceImage::new(
            "i".into(),
            "w".into(),
            "a.png".into(),
            "image/png".into(),
            1,
            1,
            1,
            0,
        );
        assert!(!image.can_publish_preview());
    }

    #[test]
    fn processing_state_does_not_publish_until_image_is_shared() {
        let mut image = WorkspaceImage::new(
            "i".into(),
            "w".into(),
            "image.png".into(),
            "image/png".into(),
            1,
            1,
            1,
            0,
        );
        image.state = ImageCollaborationState::Working;
        assert!(!image.can_publish_preview());
        image.share();
        assert!(image.can_publish_preview());
        image.unshare();
        assert_eq!(image.state, ImageCollaborationState::Private);
        assert!(!image.can_publish_preview());
    }
    #[test]
    fn invalid_direct_commit_is_rejected() {
        assert!(
            ImageCollaborationState::Private
                .transition(ImageStateEvent::Commit)
                .is_err()
        );
    }
    #[test]
    fn legacy_updated_deserializes_as_committed() {
        let value: ImageCollaborationState = serde_json::from_str("\"updated\"").unwrap();
        assert_eq!(value, ImageCollaborationState::Committed);
    }
}
