import { McpSettingsPanel } from './McpSettingsPanel';
import type { McpServerConfig, McpToolsGroup, Metrics } from '../types/chat';

interface MetricsSidebarProps {
  metrics: Metrics;
  isGenerating: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  mcpServers: McpServerConfig[];
  mcpToolsGrouped: McpToolsGroup[];
  mcpToolErrors: string[];
  isToolsLoading: boolean;
  onRefreshTools: () => Promise<void>;
  onCreateMcpServer: (payload: Partial<McpServerConfig>) => Promise<void>;
  onUpdateMcpServer: (id: string, patch: Partial<McpServerConfig>) => Promise<void>;
  onDeleteMcpServer: (id: string) => Promise<void>;
  onTestMcpServer: (id: string) => Promise<{ toolCount: number; toolNames: string[] }>;
}

function formatValue(value: number | null, decimals = 2) {
  if (value === null) return '--';
  return value.toFixed(decimals);
}

export function MetricsSidebar({
  metrics,
  isGenerating,
  isOpen,
  onClose,
  mcpServers,
  mcpToolsGrouped,
  mcpToolErrors,
  isToolsLoading,
  onRefreshTools,
  onCreateMcpServer,
  onUpdateMcpServer,
  onDeleteMcpServer,
  onTestMcpServer,
}: MetricsSidebarProps) {
  return (
    <>
      {isOpen && <div className="mobile-overlay" onClick={onClose} />}
      <aside className={`sidebar right ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2 className="sidebar-title">
            Inspector {isGenerating && <span className="status-dot generating"></span>}
          </h2>
          {onClose && (
            <button className="sidebar-toggle-mobile" onClick={onClose} aria-label="Close Inspector">
              ✕
            </button>
          )}
        </div>

        <div className="metrics-content">
          <div className="metric-row">
            <span className="metric-label">TTFT</span>
            <span className="metric-value">
              {formatValue(metrics.ttft, 0)}<span className="metric-unit">ms</span>
            </span>
          </div>
          <div className="metric-row">
            <span className="metric-label">Speed</span>
            <span className="metric-value">
              {formatValue(metrics.tokensPerSec)}<span className="metric-unit">t/s</span>
            </span>
          </div>
          <div className="metric-row">
            <span className="metric-label">Latency</span>
            <span className="metric-value">
              {formatValue(metrics.totalLatency, 0)}<span className="metric-unit">ms</span>
            </span>
          </div>
          <div className="metric-row">
            <span className="metric-label">Tokens</span>
            <span className="metric-value">{metrics.totalTokens}</span>
          </div>
        </div>

        <McpSettingsPanel
          servers={mcpServers}
          groupedTools={mcpToolsGrouped}
          toolErrors={mcpToolErrors}
          isLoading={isToolsLoading}
          onRefresh={onRefreshTools}
          onCreateServer={onCreateMcpServer}
          onUpdateServer={onUpdateMcpServer}
          onDeleteServer={onDeleteMcpServer}
          onTestServer={onTestMcpServer}
        />
      </aside>
    </>
  );
}
