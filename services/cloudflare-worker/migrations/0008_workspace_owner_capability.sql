ALTER TABLE workspaces
  ADD COLUMN owner_capability_hash TEXT;

-- Existing rows cannot recover a plaintext capability. Assigning an unknown digest
-- prevents an old Workspace ID from acting as an Owner credential.
UPDATE workspaces
SET owner_capability_hash = lower(hex(randomblob(32)))
WHERE owner_capability_hash IS NULL;

