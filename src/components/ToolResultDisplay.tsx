import type { ReactNode } from 'react';

interface ToolResultDisplayProps {
  icon: string;
  summary: ReactNode;
  content: ReactNode;
  className?: string;
  contentClassName?: string;
  renderAsPre?: boolean;
}

export function ToolResultDisplay({
  icon,
  summary,
  content,
  className,
  contentClassName = 'tool-result-content',
  renderAsPre = false,
}: ToolResultDisplayProps) {
  return (
    <details className={`tool-result-details ${className ?? ''}`.trim()}>
      <summary className="tool-result-summary">
        <span className="tool-icon">{icon}</span>
        {summary}
      </summary>
      {renderAsPre ? (
        <pre className={contentClassName}>{content}</pre>
      ) : (
        <div className={contentClassName}>{content}</div>
      )}
    </details>
  );
}
