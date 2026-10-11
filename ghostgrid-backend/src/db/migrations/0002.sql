CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(json_extract(data,'$.status'));
CREATE INDEX IF NOT EXISTS tasks_agent_idx ON tasks(agent_id);
CREATE INDEX IF NOT EXISTS usage_task_idx ON usage_records(task_id);
CREATE INDEX IF NOT EXISTS events_session_idx ON execution_events(json_extract(data,'$.sessionId'),seq);
CREATE INDEX IF NOT EXISTS events_project_idx ON execution_events(json_extract(data,'$.projectId'),seq);
CREATE INDEX IF NOT EXISTS events_agent_idx ON execution_events(json_extract(data,'$.agentId'),seq);
