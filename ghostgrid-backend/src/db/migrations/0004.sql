-- Make "this agent belongs to no city building" an explicit, visible state.
--
-- Agents created before the API normalised the field simply have no `buildingId` key, so a
-- reader cannot tell a deliberate API-client agent from a city agent whose building was lost.
-- Writing JSON null keeps every resolution rule identical (json_extract still yields SQL NULL,
-- COALESCE(buildingId,id) still falls back to the agent id) while making the state readable in
-- GET /api/v1/agents and in the database itself.
--
-- Safe: touches only rows where the key is absent, so re-running it changes nothing, and no row
-- is deleted or re-keyed. Reversible with:
--   UPDATE agents SET data=json_remove(data,'$.buildingId')
--     WHERE json_type(data,'$.buildingId')='null';
UPDATE agents
SET data = json_set(data, '$.buildingId', json('null'))
WHERE json_type(data, '$.buildingId') IS NULL;
