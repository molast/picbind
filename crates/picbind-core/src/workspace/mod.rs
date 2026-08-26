use serde::{Deserialize, Serialize};

pub const CACHE_VERSION: u16 = 1;
pub const STYLE_VERSION: u16 = 1;
pub const PREVIEW_TTL_MS: i64 = 30 * 86_400_000;
pub const SOURCE_TTL_MS: i64 = 90 * 86_400_000;
pub const COMMIT_TTL_MS: i64 = 30 * 86_400_000;
pub const ACTIVITY_TTL_MS: i64 = 30 * 86_400_000;
pub const ACTIVITY_LIMIT: usize = 50;
pub const COMMIT_LIMIT_PER_IMAGE: usize = 20;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceRole {
    Owner,
    Collaborator,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceKind {
    Local,
    Shared,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIdentity {
    pub workspace_id: String,
    pub name: String,
    pub kind: WorkspaceKind,
    pub role: WorkspaceRole,
    pub share_token: Option<String>,
    pub owner_capability: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl WorkspaceIdentity {
    pub fn local(workspace_id: String, now: i64) -> Self {
        Self {
            workspace_id,
            name: "My Workspace".into(),
            kind: WorkspaceKind::Local,
            role: WorkspaceRole::Owner,
            share_token: None,
            owner_capability: None,
            created_at: now,
            updated_at: now,
        }
    }

    pub fn attach_share(&mut self, share_token: String, owner_capability: String, now: i64) {
        self.kind = WorkspaceKind::Shared;
        self.share_token = Some(share_token);
        self.owner_capability = Some(owner_capability);
        self.updated_at = now;
    }

    pub fn rotate_share(&mut self, share_token: String, now: i64) -> Result<(), &'static str> {
        if self.role != WorkspaceRole::Owner || self.owner_capability.is_none() {
            return Err("owner capability required");
        }
        self.share_token = Some(share_token);
        self.updated_at = now;
        Ok(())
    }

    pub fn collaborator(workspace_id: String, share_token: String, name: String, now: i64) -> Self {
        Self {
            workspace_id,
            name,
            kind: WorkspaceKind::Shared,
            role: WorkspaceRole::Collaborator,
            share_token: Some(share_token),
            owner_capability: None,
            created_at: now,
            updated_at: now,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceState {
    Local,
    Connecting,
    Connected,
    Syncing,
    Available,
    OwnerOffline,
    Unavailable,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceStateEvent {
    Connect,
    SocketConnected,
    StartSync,
    Synced,
    OwnerOnline,
    OwnerOffline,
    Disconnected,
}

impl WorkspaceState {
    pub fn transition(self, event: WorkspaceStateEvent) -> Result<Self, &'static str> {
        use WorkspaceState as S;
        use WorkspaceStateEvent as E;
        match (self, event) {
            (S::Local, E::Connect) | (S::Unavailable, E::Connect) => Ok(S::Connecting),
            (S::Connecting, E::SocketConnected) => Ok(S::Connected),
            (S::Connected, E::StartSync) | (S::OwnerOffline, E::OwnerOnline) => Ok(S::Syncing),
            (S::Syncing, E::Synced) => Ok(S::Available),
            (S::Connected | S::Syncing | S::Available, E::OwnerOffline) => Ok(S::OwnerOffline),
            (
                S::Connecting | S::Connected | S::Syncing | S::Available | S::OwnerOffline,
                E::Disconnected,
            ) => Ok(S::Unavailable),
            _ => Err("invalid workspace transition"),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GradientDirection {
    #[default]
    Right,
    Down,
    DownRight,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum HeaderBackground {
    Solid {
        color: String,
    },
    Gradient {
        from: String,
        to: String,
        direction: GradientDirection,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStyle {
    pub version: u16,
    pub revision: u64,
    pub title: String,
    pub text_color: String,
    pub font_family: String,
    pub font_size: u16,
    pub font_weight: u16,
    pub background: HeaderBackground,
}

impl Default for WorkspaceStyle {
    fn default() -> Self {
        Self {
            version: STYLE_VERSION,
            revision: 0,
            title: "My Workspace".into(),
            text_color: "#273247".into(),
            font_family: "Inter".into(),
            font_size: 18,
            font_weight: 600,
            background: HeaderBackground::Solid {
                color: "#FFFFFF".into(),
            },
        }
    }
}

impl WorkspaceStyle {
    pub fn validate(&self) -> Result<(), &'static str> {
        fn color(v: &str) -> bool {
            v.len() == 7 && v.starts_with('#') && v[1..].bytes().all(|b| b.is_ascii_hexdigit())
        }
        let background = match &self.background {
            HeaderBackground::Solid { color: value } => color(value),
            HeaderBackground::Gradient { from, to, .. } => color(from) && color(to),
        };
        if self.version != STYLE_VERSION
            || self.title.trim().is_empty()
            || self.title.len() > 80
            || !color(&self.text_color)
            || !background
            || !(12..=32).contains(&self.font_size)
            || ![400, 500, 600, 700].contains(&self.font_weight)
            || !["Inter", "System", "Serif", "Monospace"].contains(&self.font_family.as_str())
        {
            return Err("invalid workspace style");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn login_is_not_part_of_workspace_identity() {
        let value = WorkspaceIdentity::local("local-1".into(), 10);
        let json = serde_json::to_string(&value).unwrap();
        assert!(!json.contains("user"));
        assert!(!json.contains("session"));
    }
    #[test]
    fn collaborator_never_receives_owner_capability() {
        let mut value =
            WorkspaceIdentity::collaborator("w".into(), "share_x".into(), "Shared".into(), 10);
        assert_eq!(value.owner_capability, None);
        assert!(value.rotate_share("share_y".into(), 20).is_err());
    }
    #[test]
    fn runtime_state_rejects_invalid_transitions() {
        assert_eq!(
            WorkspaceState::Local.transition(WorkspaceStateEvent::Connect),
            Ok(WorkspaceState::Connecting)
        );
        assert!(
            WorkspaceState::Local
                .transition(WorkspaceStateEvent::Synced)
                .is_err()
        );
    }
    #[test]
    fn style_schema_is_restricted() {
        assert!(WorkspaceStyle::default().validate().is_ok());
        let invalid = WorkspaceStyle {
            text_color: "url(javascript:x)".into(),
            ..Default::default()
        };
        assert!(invalid.validate().is_err());
    }
}
