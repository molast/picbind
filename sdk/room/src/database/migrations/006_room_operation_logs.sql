CREATE TABLE room_operation_logs (
  room_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  progress REAL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, id)
);

CREATE INDEX room_operation_logs_room_created_idx
  ON room_operation_logs(room_id, created_at ASC);
