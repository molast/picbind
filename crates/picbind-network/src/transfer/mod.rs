use std::collections::{HashMap, HashSet};

use picbind_protocol::events::{Reliability, WorkspaceEvent};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Transport {
    WebSocket,
    WebRtc,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct RtcQualification {
    pub control_open: bool,
    pub bulk_open: bool,
    pub probe_acknowledged: bool,
    pub stable: bool,
    pub ready_epoch_matches: bool,
}

impl RtcQualification {
    pub fn qualified(self) -> bool {
        self.control_open
            && self.bulk_open
            && self.probe_acknowledged
            && self.stable
            && self.ready_epoch_matches
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SessionRole {
    Owner,
    Collaborator,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RelayRoute<'a> {
    Workspace,
    Owner,
    User(&'a str),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransportTarget {
    pub user_id: Option<String>,
    pub transport: Transport,
    pub targeted_socket_relay: bool,
}

#[derive(Debug, Default)]
pub struct TransportRouter {
    peers: HashMap<String, RtcQualification>,
    online_collaborators: HashSet<String>,
    reliable_ws_events: HashSet<String>,
}

impl TransportRouter {
    pub fn queued_reliable(&self) -> usize {
        self.reliable_ws_events.len()
    }

    pub fn record_ws_enqueue(&mut self, event: &WorkspaceEvent) {
        if event.reliability == Reliability::Reliable {
            self.reliable_ws_events.insert(event.event_id.clone());
        }
    }

    pub fn record_ws_ack(&mut self, event_id: &str) {
        self.reliable_ws_events.remove(event_id);
    }

    pub fn set_collaborator_online(&mut self, user_id: impl Into<String>, online: bool) {
        let user_id = user_id.into();
        if online {
            self.online_collaborators.insert(user_id);
        } else {
            self.online_collaborators.remove(&user_id);
            self.peers.remove(&user_id);
        }
    }

    pub fn set_rtc_qualification(&mut self, user_id: impl Into<String>, value: RtcQualification) {
        self.peers.insert(user_id.into(), value);
    }

    pub fn rtc_failed(&mut self, user_id: &str) {
        self.peers.remove(user_id);
    }

    pub fn active_for(&self, user_id: &str) -> Transport {
        if self.reliable_ws_events.is_empty()
            && self
                .peers
                .get(user_id)
                .is_some_and(|value| value.qualified())
        {
            Transport::WebRtc
        } else {
            Transport::WebSocket
        }
    }

    pub fn route(&self, role: SessionRole, route: RelayRoute<'_>) -> Vec<TransportTarget> {
        if role == SessionRole::Collaborator {
            return vec![TransportTarget {
                user_id: Some("owner".into()),
                transport: self.active_for("owner"),
                targeted_socket_relay: false,
            }];
        }

        match route {
            RelayRoute::User(user_id) => vec![TransportTarget {
                user_id: Some(user_id.into()),
                transport: self.active_for(user_id),
                targeted_socket_relay: false,
            }],
            RelayRoute::Owner => vec![TransportTarget {
                user_id: None,
                transport: Transport::WebSocket,
                targeted_socket_relay: false,
            }],
            RelayRoute::Workspace if self.online_collaborators.is_empty() => {
                vec![TransportTarget {
                    user_id: None,
                    transport: Transport::WebSocket,
                    targeted_socket_relay: false,
                }]
            }
            RelayRoute::Workspace => {
                let mut users = self.online_collaborators.iter().collect::<Vec<_>>();
                users.sort();
                users
                    .into_iter()
                    .map(|user_id| {
                        let transport = self.active_for(user_id);
                        TransportTarget {
                            user_id: Some(user_id.clone()),
                            transport,
                            targeted_socket_relay: transport == Transport::WebSocket,
                        }
                    })
                    .collect()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use picbind_protocol::events::DataClass;
    use serde_json::Value;

    fn event(id: &str) -> WorkspaceEvent {
        WorkspaceEvent {
            event_id: id.into(),
            sequence: 1,
            timestamp: 0,
            data_class: DataClass::Preview,
            reliability: Reliability::Reliable,
            kind: "preview".into(),
            payload: Value::Null,
        }
    }

    fn qualified() -> RtcQualification {
        RtcQualification {
            control_open: true,
            bulk_open: true,
            probe_acknowledged: true,
            stable: true,
            ready_epoch_matches: true,
        }
    }

    #[test]
    fn rtc_requires_qualification_and_a_drained_reliable_queue() {
        let mut router = TransportRouter::default();
        router.set_rtc_qualification("guest-1", qualified());
        router.record_ws_enqueue(&event("event-1"));
        assert_eq!(router.active_for("guest-1"), Transport::WebSocket);
        router.record_ws_ack("event-1");
        assert_eq!(router.active_for("guest-1"), Transport::WebRtc);
    }

    #[test]
    fn owner_workspace_broadcast_routes_each_peer_independently() {
        let mut router = TransportRouter::default();
        router.set_collaborator_online("guest-rtc", true);
        router.set_collaborator_online("guest-socket", true);
        router.set_rtc_qualification("guest-rtc", qualified());

        let targets = router.route(SessionRole::Owner, RelayRoute::Workspace);
        assert_eq!(
            targets,
            vec![
                TransportTarget {
                    user_id: Some("guest-rtc".into()),
                    transport: Transport::WebRtc,
                    targeted_socket_relay: false,
                },
                TransportTarget {
                    user_id: Some("guest-socket".into()),
                    transport: Transport::WebSocket,
                    targeted_socket_relay: true,
                },
            ]
        );
    }

    #[test]
    fn one_peer_failure_does_not_demote_other_peers() {
        let mut router = TransportRouter::default();
        router.set_rtc_qualification("guest-1", qualified());
        router.set_rtc_qualification("guest-2", qualified());
        router.rtc_failed("guest-1");
        assert_eq!(router.active_for("guest-1"), Transport::WebSocket);
        assert_eq!(router.active_for("guest-2"), Transport::WebRtc);
    }
}
