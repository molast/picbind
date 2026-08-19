use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PresenceStatus {
    Online,
    Offline,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Collaborator {
    pub client_id: String,
    pub display_name: String,
    pub status: PresenceStatus,
    pub current_action: Option<String>,
    pub current_image_id: Option<String>,
    pub last_seen_at: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Reaction {
    ThumbsUp,
    Heart,
    Eyes,
    Important,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub event_id: String,
    pub sequence: u64,
    pub actor_id: String,
    pub kind: String,
    pub image_id: Option<String>,
    pub detail: Value,
    pub created_at: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OperationType {
    Crop,
    Resize,
    Rotate,
    Brightness,
    Contrast,
    Saturation,
    Compression,
    Other,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    pub operation_id: String,
    pub image_id: String,
    pub author_id: String,
    pub base_commit_id: String,
    pub operation_type: OperationType,
    pub parameters: Value,
    pub created_at: i64,
}

impl Operation {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.operation_id.is_empty()
            || self.image_id.is_empty()
            || self.author_id.is_empty()
            || self.base_commit_id.is_empty()
        {
            return Err("missing operation identity");
        }
        let object = self
            .parameters
            .as_object()
            .ok_or("operation parameters must be an object")?;
        if self.operation_type == OperationType::Resize {
            let width = object.get("width").and_then(Value::as_u64).unwrap_or(0);
            let height = object.get("height").and_then(Value::as_u64).unwrap_or(0);
            if width == 0 || height == 0 || width > 32_768 || height > 32_768 {
                return Err("invalid resize dimensions");
            }
        }
        if self.operation_type == OperationType::Crop {
            let number = |key: &str| object.get(key).and_then(Value::as_f64);
            let (Some(x), Some(y), Some(width), Some(height)) =
                (number("x"), number("y"), number("width"), number("height"))
            else {
                return Err("invalid crop bounds");
            };
            if !x.is_finite()
                || !y.is_finite()
                || !width.is_finite()
                || !height.is_finite()
                || x < 0.0
                || y < 0.0
                || width <= 0.0
                || height <= 0.0
                || x + width > 1.0
                || y + height > 1.0
            {
                return Err("invalid crop bounds");
            }
        }
        if self.operation_type == OperationType::Rotate
            && !matches!(
                object.get("degrees").and_then(Value::as_u64),
                Some(90 | 180 | 270)
            )
        {
            return Err("invalid rotation");
        }
        if self.operation_type == OperationType::Compression
            && object.get("format").is_some_and(|value| {
                !matches!(
                    value.as_str(),
                    Some("auto" | "jpeg" | "png" | "webp" | "avif")
                )
            })
        {
            return Err("invalid compression format");
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProposalState {
    #[default]
    Draft,
    Submitted,
    Pending,
    Applied,
    Rejected,
    Deferred,
    Failed,
    Conflict,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProposalEvent {
    Submit,
    Accept,
    Apply,
    Reject,
    Defer,
    Fail,
    Retry,
    DetectConflict,
}

impl ProposalState {
    pub fn transition(self, event: ProposalEvent) -> Result<Self, &'static str> {
        use ProposalEvent as E;
        use ProposalState as S;
        match (self, event) {
            (S::Draft, E::Submit) | (S::Failed, E::Retry) => Ok(S::Submitted),
            (S::Submitted, E::Accept) => Ok(S::Pending),
            (S::Pending | S::Deferred | S::Conflict, E::Apply) => Ok(S::Applied),
            (S::Pending | S::Deferred | S::Conflict, E::Reject) => Ok(S::Rejected),
            (S::Pending | S::Conflict, E::Defer) => Ok(S::Deferred),
            (S::Submitted, E::Fail) => Ok(S::Failed),
            (S::Pending, E::DetectConflict) => Ok(S::Conflict),
            _ => Err("invalid proposal transition"),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Proposal {
    pub proposal_id: String,
    pub workspace_id: String,
    pub image_id: String,
    pub author_id: String,
    pub base_commit_id: String,
    pub operations: Vec<Operation>,
    pub state: ProposalState,
    pub reject_reason: Option<String>,
    pub created_at: i64,
}

impl Proposal {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.operations.is_empty() {
            return Err("proposal has no operations");
        }
        if self.operations.iter().any(|op| {
            op.image_id != self.image_id
                || op.author_id != self.author_id
                || op.base_commit_id != self.base_commit_id
                || op.validate().is_err()
        }) {
            return Err("proposal operation mismatch");
        }
        Ok(())
    }
    pub fn conflicts_with(&self, current_commit_id: &str) -> bool {
        self.base_commit_id != current_commit_id
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub commit_id: String,
    pub image_id: String,
    pub author_id: String,
    pub parent_commit_id: Option<String>,
    pub merge_parent_commit_ids: Vec<String>,
    pub operations: Vec<Operation>,
    pub created_at: i64,
}

impl Commit {
    pub fn from_proposal(
        commit_id: String,
        owner_id: String,
        current_commit_id: Option<String>,
        proposal: &Proposal,
        now: i64,
    ) -> Result<Self, &'static str> {
        proposal.validate()?;
        let mut merge = Vec::new();
        if current_commit_id
            .as_deref()
            .is_some_and(|id| id != proposal.base_commit_id)
        {
            merge.push(proposal.base_commit_id.clone());
        }
        Ok(Self {
            commit_id,
            image_id: proposal.image_id.clone(),
            author_id: owner_id,
            parent_commit_id: current_commit_id,
            merge_parent_commit_ids: merge,
            operations: proposal.operations.clone(),
            created_at: now,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn operation() -> Operation {
        Operation {
            operation_id: "o".into(),
            image_id: "i".into(),
            author_id: "a".into(),
            base_commit_id: "c1".into(),
            operation_type: OperationType::Resize,
            parameters: serde_json::json!({"width":10,"height":20}),
            created_at: 0,
        }
    }
    #[test]
    fn terminal_proposals_cannot_transition_again() {
        assert!(
            ProposalState::Applied
                .transition(ProposalEvent::Reject)
                .is_err()
        );
    }
    #[test]
    fn conflict_commit_keeps_current_parent_and_merge_parent() {
        let p = Proposal {
            proposal_id: "p".into(),
            workspace_id: "w".into(),
            image_id: "i".into(),
            author_id: "a".into(),
            base_commit_id: "c1".into(),
            operations: vec![operation()],
            state: ProposalState::Pending,
            reject_reason: None,
            created_at: 0,
        };
        let c =
            Commit::from_proposal("c3".into(), "owner".into(), Some("c2".into()), &p, 1).unwrap();
        assert_eq!(c.parent_commit_id.as_deref(), Some("c2"));
        assert_eq!(c.merge_parent_commit_ids, vec!["c1"]);
    }

    #[test]
    fn invalid_operation_parameters_are_rejected_before_review() {
        let mut resize = operation();
        resize.parameters = serde_json::json!({"width": 0, "height": 20});
        assert!(resize.validate().is_err());

        let mut crop = operation();
        crop.operation_type = OperationType::Crop;
        crop.parameters = serde_json::json!({"x": 0.8, "y": 0.0, "width": 0.3, "height": 1.0});
        assert!(crop.validate().is_err());

        let mut rotate = operation();
        rotate.operation_type = OperationType::Rotate;
        rotate.parameters = serde_json::json!({"degrees": 45});
        assert!(rotate.validate().is_err());
    }
}
