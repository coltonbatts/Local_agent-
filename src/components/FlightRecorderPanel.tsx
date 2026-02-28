import { useState, useEffect, useCallback } from 'react';
import type { ToolExecutionEvent } from '../types/chat';

interface FlightRecorderPanelProps {
  onReplayToolCall?: (eventId: string) => void;
  replayingEventId?: string | null;
  toolApiKey?: string;
}

interface ToolEventFromApi extends ToolExecutionEvent {
  args_preview?: unknown;
}

function toPrettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatDuration(durationMs: number | null | undefined): string {
  if (typeof durationMs !== 'number' || Number.isNaN(durationMs)) return '--';
  return `${durationMs}ms`;
}

function getToolLabel(event: ToolEventFromApi): string {
  if (event.source === 'mcp') {
    const server = event.server_name || event.server_id || 'unknown';
    const tool = event.mcp_tool_name || event.tool_name;
    return `${server} / ${tool}`;
  }
  return event.tool_name || 'unknown';
}

export function FlightRecorderPanel({
  onReplayToolCall,
  replayingEventId,
  toolApiKey,
}: FlightRecorderPanelProps) {
  const [events, setEvents] = useState<ToolEventFromApi[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterTool, setFilterTool] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterServer, setFilterServer] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildHeaders = useCallback((): HeadersInit => {
    const headers: Record<string, string> = {};
    if (toolApiKey) {
      headers['x-tool-api-key'] = toolApiKey;
    }
    return headers;
  }, [toolApiKey]);

  const fetchEvents = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterTool.trim()) params.set('tool_name', filterTool.trim());
      if (filterStatus.trim()) params.set('status', filterStatus.trim());
      if (filterServer.trim()) params.set('server_id', filterServer.trim());
      params.set('limit', '50');

      const res = await fetch(`/api/tools/events?${params}`, {
        headers: buildHeaders(),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to load events');
      }

      setEvents(Array.isArray(data.events) ? data.events : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load events');
      setEvents([]);
    } finally {
      setIsLoading(false);
    }
  }, [filterTool, filterStatus, filterServer, buildHeaders]);

  useEffect(() => {
    const t = setTimeout(() => void fetchEvents(), 200);
    return () => clearTimeout(t);
  }, [fetchEvents]);

  const selectedEvent = selectedId ? events.find((e) => e.id === selectedId) ?? null : null;

  return (
    <div className="flight-recorder-panel">
      <div className="flight-recorder-header">
        <h3 className="flight-recorder-title">Flight Recorder</h3>
        <button
          type="button"
          className="flight-recorder-refresh"
          onClick={() => void fetchEvents()}
          disabled={isLoading}
          aria-label="Refresh events"
        >
          {isLoading ? '…' : '↻'}
        </button>
      </div>

      <div className="flight-recorder-filters">
        <input
          type="text"
          placeholder="Tool name"
          value={filterTool}
          onChange={(e) => setFilterTool(e.target.value)}
          className="flight-recorder-filter-input"
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="flight-recorder-filter-select"
        >
          <option value="">All statuses</option>
          <option value="success">success</option>
          <option value="error">error</option>
          <option value="running">running</option>
        </select>
        <input
          type="text"
          placeholder="MCP server"
          value={filterServer}
          onChange={(e) => setFilterServer(e.target.value)}
          className="flight-recorder-filter-input"
        />
      </div>

      {error && (
        <div className="flight-recorder-error">{error}</div>
      )}

      <div className="flight-recorder-list">
        {events.length === 0 && !isLoading && (
          <div className="flight-recorder-empty">No tool events recorded yet.</div>
        )}
        {events.map((event) => (
          <div
            key={event.id}
            className={`flight-recorder-item ${selectedId === event.id ? 'selected' : ''} status-${event.status}`}
            onClick={() => setSelectedId(selectedId === event.id ? null : event.id)}
          >
            <div className="flight-recorder-item-header">
              <span className="flight-recorder-item-tool" title={event.tool_name}>
                {getToolLabel(event)}
              </span>
              <span className="flight-recorder-item-meta">
                #{event.sequence} · {event.status} · {formatDuration(event.duration_ms)}
              </span>
            </div>
            <div className="flight-recorder-item-time">
              {new Date(event.started_at).toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      {selectedEvent && (
        <div className="flight-recorder-detail">
          <div className="flight-recorder-detail-header">
            <span className="flight-recorder-detail-title">{getToolLabel(selectedEvent)}</span>
            {onReplayToolCall && (
              <button
                type="button"
                onClick={() => onReplayToolCall(selectedEvent.id)}
                disabled={replayingEventId === selectedEvent.id}
              >
                {replayingEventId === selectedEvent.id ? 'Replaying…' : 'Replay tool call'}
              </button>
            )}
          </div>
          <div className="flight-recorder-detail-meta">
            <div>ID: {selectedEvent.id}</div>
            <div>Sequence: {selectedEvent.sequence}</div>
            <div>Status: {selectedEvent.status}</div>
            <div>Duration: {formatDuration(selectedEvent.duration_ms)}</div>
            <div>Started: {new Date(selectedEvent.started_at).toLocaleString()}</div>
            {selectedEvent.ended_at && (
              <div>Ended: {new Date(selectedEvent.ended_at).toLocaleString()}</div>
            )}
            {selectedEvent.replay_of && <div>Replay of: {selectedEvent.replay_of}</div>}
            {selectedEvent.error_message && (
              <div className="flight-recorder-error-msg">Error: {selectedEvent.error_message}</div>
            )}
          </div>
          <div className="flight-recorder-detail-section">
            <div className="flight-recorder-detail-label">Args (sanitized)</div>
            <pre className="flight-recorder-detail-pre">
              {toPrettyJson(selectedEvent.args_preview ?? selectedEvent.args ?? {})}
            </pre>
          </div>
          <div className="flight-recorder-detail-section">
            <div className="flight-recorder-detail-label">Result (sanitized)</div>
            <pre className="flight-recorder-detail-pre">
              {toPrettyJson(selectedEvent.result ?? null)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
