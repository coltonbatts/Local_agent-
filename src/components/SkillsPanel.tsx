import { useState } from 'react';
import type { Skill, SkillsSyncState } from '../types/chat';

interface SkillsPanelProps {
  skills: Skill[];
  syncState: SkillsSyncState | null;
  onSync: () => Promise<void>;
  onRefresh: () => void;
  toolApiKey?: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function shortHash(ref: string | null): string {
  if (!ref) return '—';
  return ref.length >= 7 ? ref.slice(0, 7) : ref;
}

export function SkillsPanel({
  skills,
  syncState,
  onSync,
  onRefresh,
  toolApiKey,
}: SkillsPanelProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncError(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (toolApiKey) headers['x-tool-api-key'] = toolApiKey;

      const res = await fetch('/api/skills/sync', {
        method: 'POST',
        headers,
        body: '{}',
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? 'Sync failed');
      }
      await onSync();
      onRefresh();
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <section className="config-panel skills-panel">
      <h3 className="config-section-title">Skills</h3>

      {skills.length === 0 ? (
        <p className="skills-empty">No skills installed. Run sync to fetch from skills-lock.json.</p>
      ) : (
        <ul className="skills-list">
          {skills.map((s) => (
            <li key={s.folderName} className="skills-item">
              <span className="skills-name">{s.name}</span>
              <span className="skills-desc">{s.description}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="skills-sync">
        <div className="skills-sync-meta">
          <span className="skills-sync-label">Installed at</span>
          <code className="skills-sync-hash" title={syncState?.sourceRef ?? undefined}>
            {shortHash(syncState?.sourceRef ?? null)}
          </code>
          {syncState?.lastSyncedAt && (
            <span className="skills-sync-date">{formatDate(syncState.lastSyncedAt)}</span>
          )}
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={isSyncing}
          className="skills-sync-btn"
        >
          {isSyncing ? 'Syncing…' : 'Sync now'}
        </button>
        {syncError && <p className="skills-sync-error">{syncError}</p>}
      </div>
    </section>
  );
}
