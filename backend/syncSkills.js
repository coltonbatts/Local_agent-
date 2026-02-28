/**
 * Sync skills from skills-lock.json into .agents/skills/<skill>/SKILL.md
 * Fetches from GitHub at the pinned ref and writes local SKILL.md files.
 */

import fs from 'fs';
import path from 'path';

const LOCK_FILENAME = 'skills-lock.json';
const SYNC_STATE_FILENAME = 'sync-state.json';

function getRepoPath(skillKey, entry) {
  if (entry.path) return entry.path;
  const base = skillKey.startsWith('vercel-') ? skillKey.slice(7) : skillKey;
  return `skills/${base}`;
}

async function resolveRef(owner, repo, ref) {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${ref}`,
    { headers: { Accept: 'application/vnd.github.v3+json' } }
  );
  if (!res.ok) {
    throw new Error(`Failed to resolve ref ${ref}: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.sha;
}

async function fetchSkillContent(owner, repo, ref, repoPath) {
  const filePath = `${repoPath}/SKILL.md`;
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }
  return res.text();
}

/**
 * Run skills sync. Writes to projectRoot/.agents/skills/
 * @param {string} projectRoot - Absolute path to project root
 * @returns {Promise<{ sourceRef: string; lastSyncedAt: string; skills: Record<string, { ok: boolean; error?: string }> }>}
 */
export async function runSync(projectRoot) {
  const skillsDir = path.join(projectRoot, '.agents', 'skills');
  const lockPath = path.join(projectRoot, LOCK_FILENAME);
  const syncStatePath = path.join(skillsDir, SYNC_STATE_FILENAME);

  const lockRaw = fs.readFileSync(lockPath, 'utf8');
  const lock = JSON.parse(lockRaw);
  const ref = lock.ref ?? 'main';

  const skills = lock.skills;
  if (!skills || Object.keys(skills).length === 0) {
    return {
      sourceRef: ref,
      lastSyncedAt: new Date().toISOString(),
      skills: {},
    };
  }

  const firstEntry = Object.values(skills)[0];
  const [owner, repo] = firstEntry.source.split('/');
  const isCommitSha = ref.length === 40 && /^[a-f0-9]+$/.test(ref);
  const resolvedRef = isCommitSha ? ref : await resolveRef(owner, repo, ref);

  const results = {};

  for (const [skillKey, entry] of Object.entries(skills)) {
    try {
      const [entryOwner, entryRepo] = entry.source.split('/');
      const repoRef =
        entryOwner === owner && entryRepo === repo
          ? resolvedRef
          : isCommitSha
            ? ref
            : await resolveRef(entryOwner, entryRepo, ref);

      const repoPath = getRepoPath(skillKey, entry);
      const content = await fetchSkillContent(entryOwner, entryRepo, repoRef, repoPath);

      const skillDir = path.join(skillsDir, skillKey);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf8');

      results[skillKey] = { ok: true };
    } catch (err) {
      results[skillKey] = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const syncState = {
    sourceRef: resolvedRef,
    lastSyncedAt: new Date().toISOString(),
    skills: results,
  };

  fs.mkdirSync(skillsDir, { recursive: true });
  fs.writeFileSync(syncStatePath, JSON.stringify(syncState, null, 2), 'utf8');

  return syncState;
}

/**
 * Read sync state from disk if it exists.
 * @param {string} projectRoot
 * @returns {{ sourceRef: string; lastSyncedAt: string } | null}
 */
export function readSyncState(projectRoot) {
  const syncStatePath = path.join(projectRoot, '.agents', 'skills', SYNC_STATE_FILENAME);
  if (!fs.existsSync(syncStatePath)) return null;
  try {
    const raw = fs.readFileSync(syncStatePath, 'utf8');
    const data = JSON.parse(raw);
    return {
      sourceRef: data.sourceRef ?? null,
      lastSyncedAt: data.lastSyncedAt ?? null,
    };
  } catch {
    return null;
  }
}
