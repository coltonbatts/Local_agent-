#!/usr/bin/env npx tsx
/**
 * CLI for syncing skills from skills-lock.json into .agents/skills/<skill>/SKILL.md
 * Uses backend/syncSkills.js for the actual sync logic.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { runSync } from '../backend/syncSkills.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

runSync(PROJECT_ROOT)
  .then((state) => {
    const ok = Object.values(state.skills).filter((s) => s.ok).length;
    const fail = Object.values(state.skills).filter((s) => !s.ok).length;
    console.log(`Synced ${ok} skills at ${state.sourceRef.slice(0, 7)}`);
    if (fail > 0) {
      console.error(`${fail} failed:`);
      for (const [k, v] of Object.entries(state.skills)) {
        if (!v.ok) console.error(`  ${k}: ${v.error}`);
      }
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error('Sync failed:', err);
    process.exit(1);
  });
