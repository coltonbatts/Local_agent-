import { useMemo, useState } from 'react';
import type { McpServerConfig, McpToolsGroup } from '../types/chat';

interface McpSettingsPanelProps {
  servers: McpServerConfig[];
  groupedTools: McpToolsGroup[];
  toolErrors: string[];
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onCreateServer: (payload: Partial<McpServerConfig>) => Promise<void>;
  onUpdateServer: (id: string, patch: Partial<McpServerConfig>) => Promise<void>;
  onDeleteServer: (id: string) => Promise<void>;
  onTestServer: (id: string) => Promise<{ toolCount: number; toolNames: string[] }>;
}

interface TestResult {
  status: 'success' | 'error';
  message: string;
}

function parseArgs(argsText: string): string[] {
  const matches = argsText.match(/"([^"]*)"|'([^']*)'|\S+/g);
  if (!matches) return [];

  return matches.map((entry) => entry.replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

function parseEnv(envText: string): Record<string, string> {
  const env: Record<string, string> = {};
  const lines = envText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const separator = line.indexOf('=');
    if (separator <= 0) {
      throw new Error(`Invalid env line '${line}'. Use KEY=VALUE format.`);
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!key) continue;
    env[key] = value;
  }

  return env;
}

function createInitialDraft(): Partial<McpServerConfig> & { argsText: string; envText: string } {
  return {
    id: '',
    name: '',
    transport: 'stdio',
    command: '',
    url: '',
    argsText: '',
    envText: '',
    capabilities_warning: '',
  };
}

export function McpSettingsPanel({
  servers,
  groupedTools,
  toolErrors,
  isLoading,
  onRefresh,
  onCreateServer,
  onUpdateServer,
  onDeleteServer,
  onTestServer,
}: McpSettingsPanelProps) {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [draft, setDraft] = useState(createInitialDraft());
  const [search, setSearch] = useState('');
  const [isToolsExpanded, setIsToolsExpanded] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [busyServerId, setBusyServerId] = useState<string | null>(null);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groupedTools;

    return groupedTools
      .map((group) => {
        const matchingTools = group.tools.filter((tool) => {
          const haystack = `${tool.tool_name} ${tool.description}`.toLowerCase();
          return haystack.includes(q);
        });

        if (matchingTools.length === 0) return null;
        return {
          ...group,
          tools: matchingTools,
        };
      })
      .filter((group): group is McpToolsGroup => group !== null);
  }, [groupedTools, search]);

  const handleCreateServer = async () => {
    try {
      const payload: Partial<McpServerConfig> = {
        id: (draft.id || '').trim(),
        name: (draft.name || '').trim() || (draft.id || '').trim(),
        transport: draft.transport,
        enabled: false,
        capabilities_warning: (draft.capabilities_warning || '').trim(),
      };

      if (payload.transport === 'stdio') {
        payload.command = (draft.command || '').trim();
        payload.args = parseArgs(draft.argsText);
        payload.env = parseEnv(draft.envText);
      } else {
        payload.url = (draft.url || '').trim();
      }

      await onCreateServer(payload);
      setIsFormOpen(false);
      setDraft(createInitialDraft());
      setStatusMessage(`Added MCP server '${payload.id}'. It is disabled by default.`);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Failed to add MCP server');
    }
  };

  const toggleServer = async (server: McpServerConfig) => {
    setBusyServerId(server.id);
    try {
      await onUpdateServer(server.id, { enabled: !server.enabled });
      setStatusMessage(`${server.name} is now ${server.enabled ? 'disabled' : 'enabled'}.`);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Failed to update server');
    } finally {
      setBusyServerId(null);
    }
  };

  const testServer = async (serverId: string) => {
    setBusyServerId(serverId);
    try {
      const result = await onTestServer(serverId);
      setTestResults((prev) => ({
        ...prev,
        [serverId]: {
          status: 'success',
          message: `Connection OK. Discovered ${result.toolCount} tools.`,
        },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection test failed';
      setTestResults((prev) => ({
        ...prev,
        [serverId]: {
          status: 'error',
          message,
        },
      }));
    } finally {
      setBusyServerId(null);
    }
  };

  const deleteServer = async (serverId: string) => {
    setBusyServerId(serverId);
    try {
      await onDeleteServer(serverId);
      setStatusMessage(`Deleted MCP server '${serverId}'.`);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Failed to delete server');
    } finally {
      setBusyServerId(null);
    }
  };

  return (
    <section className="mcp-panel">
      <div className="mcp-panel-header-row">
        <h3 className="mcp-panel-title">MCP Servers</h3>
        <div className="mcp-panel-actions">
          <button onClick={() => setIsFormOpen((prev) => !prev)}>
            {isFormOpen ? '[CLOSE]' : '[ADD]'}
          </button>
          <button onClick={() => void onRefresh()} disabled={isLoading}>
            {isLoading ? '[…]' : '[REFRESH]'}
          </button>
        </div>
      </div>

      {statusMessage && <div className="mcp-status-message">{statusMessage}</div>}

      {isFormOpen && (
        <div className="mcp-form">
          <label>
            ID
            <input
              value={draft.id}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, id: event.target.value.toLowerCase() }))
              }
              placeholder="filesystem"
            />
          </label>
          <label>
            Name
            <input
              value={draft.name}
              onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Filesystem MCP"
            />
          </label>
          <label>
            Transport
            <select
              value={draft.transport}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  transport: event.target.value as McpServerConfig['transport'],
                }))
              }
            >
              <option value="stdio">stdio</option>
              <option value="http">http</option>
              <option value="sse">sse</option>
            </select>
          </label>

          {draft.transport === 'stdio' ? (
            <>
              <label>
                Command
                <input
                  value={draft.command}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, command: event.target.value }))
                  }
                  placeholder="npx"
                />
              </label>
              <label>
                Args
                <input
                  value={draft.argsText}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, argsText: event.target.value }))
                  }
                  placeholder="-y @modelcontextprotocol/server-filesystem /Users/you"
                />
              </label>
              <label>
                Env (KEY=VALUE per line)
                <textarea
                  value={draft.envText}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, envText: event.target.value }))
                  }
                  rows={3}
                />
              </label>
            </>
          ) : (
            <label>
              URL
              <input
                value={draft.url}
                onChange={(event) => setDraft((prev) => ({ ...prev, url: event.target.value }))}
                placeholder="http://127.0.0.1:4000/mcp"
              />
            </label>
          )}

          <label>
            Capabilities Warning
            <textarea
              value={draft.capabilities_warning}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, capabilities_warning: event.target.value }))
              }
              rows={2}
              placeholder="This server can access local files and run shell commands."
            />
          </label>

          <button onClick={() => void handleCreateServer()}>[SAVE SERVER]</button>
        </div>
      )}

      <div className="mcp-server-list">
        {servers.length === 0 && <div className="empty-history">No MCP servers configured.</div>}
        {servers.map((server) => {
          const test = testResults[server.id];
          const isBusy = busyServerId === server.id;
          return (
            <div className="mcp-server-card" key={server.id}>
              <div className="mcp-server-head">
                <div>
                  <div className="mcp-server-name">{server.name}</div>
                  <div className="mcp-server-id">
                    {server.id} · {server.transport}
                  </div>
                </div>
                <label className="mcp-toggle">
                  <input
                    type="checkbox"
                    checked={server.enabled}
                    disabled={isBusy}
                    onChange={() => void toggleServer(server)}
                  />
                  <span>{server.enabled ? 'ON' : 'OFF'}</span>
                </label>
              </div>

              <div className="mcp-server-details">
                {server.transport === 'stdio' ? (
                  <code>
                    {server.command} {(server.args ?? []).join(' ')}
                  </code>
                ) : (
                  <code>{server.url}</code>
                )}
                {server.capabilities_warning && (
                  <div className="mcp-warning-text">⚠ {server.capabilities_warning}</div>
                )}
              </div>

              <div className="mcp-server-actions">
                <button onClick={() => void testServer(server.id)} disabled={isBusy}>
                  [TEST]
                </button>
                <button onClick={() => void deleteServer(server.id)} disabled={isBusy}>
                  [DELETE]
                </button>
              </div>

              {test && <div className={`mcp-test-result ${test.status}`}>{test.message}</div>}
            </div>
          );
        })}
      </div>

      <div className={`mcp-tools-section ${isToolsExpanded ? 'expanded' : 'collapsed'}`}>
        <button
          type="button"
          className="mcp-tools-section-header"
          onClick={() => setIsToolsExpanded((prev) => !prev)}
          aria-expanded={isToolsExpanded}
        >
          <span className="mcp-tools-section-chevron">{isToolsExpanded ? '▼' : '▶'}</span>
          <h3 className="mcp-panel-title">Available Tools</h3>
          <span className="mcp-tools-count">
            ({filteredGroups.reduce((n, g) => n + g.tools.length, 0)})
          </span>
        </button>

        {isToolsExpanded && (
          <>
            <div className="mcp-panel-header-row mcp-tools-search-row">
              <input
                className="mcp-tools-search"
                placeholder="Search tools..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            {toolErrors.length > 0 && (
              <div className="mcp-discovery-errors">
                {toolErrors.map((error) => (
                  <div key={error}>{error}</div>
                ))}
              </div>
            )}

            {filteredGroups.length === 0 ? (
              <div className="empty-history">No tools discovered from enabled servers.</div>
            ) : (
              <div className="mcp-group-list">
                {filteredGroups.map((group) => (
                  <div key={group.server_id} className="mcp-tool-group">
                    <div className="mcp-tool-group-title">
                      {group.server_name} ({group.server_id})
                    </div>
                    {group.tools.map((tool) => (
                      <div className="mcp-tool-row" key={`${tool.server_id}.${tool.tool_name}`}>
                        <div className="mcp-tool-name">{tool.tool_name}</div>
                        <div className="mcp-tool-description">
                          {tool.description || 'No description provided.'}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
