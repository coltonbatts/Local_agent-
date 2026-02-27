import type { Metrics } from '../types/chat';

interface MetricsSidebarProps {
  metrics: Metrics;
  isGenerating: boolean;
}

function formatValue(value: number | null, decimals = 2) {
  if (value === null) return '--';
  return value.toFixed(decimals);
}

export function MetricsSidebar({ metrics, isGenerating }: MetricsSidebarProps) {
  return (
    <aside className="glass-panel metrics-sidebar">
      <div className="sidebar-header">
        <h2 className="sidebar-title">
          <div className={`status-dot ${isGenerating ? 'generating' : ''}`}></div>
          System Telemetry
        </h2>
      </div>

      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">TTFT (Time To First Token)</div>
          <div className="metric-value">
            {formatValue(metrics.ttft, 0)}
            <span className="metric-unit">ms</span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Generation Speed</div>
          <div className="metric-value">
            {formatValue(metrics.tokensPerSec)}
            <span className="metric-unit">tok/s</span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Total Latency</div>
          <div className="metric-value">
            {formatValue(metrics.totalLatency, 0)}
            <span className="metric-unit">ms</span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Tokens Rendered</div>
          <div className="metric-value">{metrics.totalTokens}</div>
        </div>
      </div>

      <div className="connection-info">
        <div className="endpoint-badge">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
          </svg>
          localhost:1234
        </div>
      </div>
    </aside>
  );
}
