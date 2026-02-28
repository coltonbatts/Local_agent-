import fs from 'fs';
import path from 'path';
import { NATIVE_TOOL_DEFINITIONS, validateToolArgs } from '../shared/tools.js';

export function resolveSafePath(projectRoot, inputPath) {
  const normalized = path.normalize(inputPath);
  const resolved = path.resolve(projectRoot, normalized);
  const relative = path.relative(projectRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path is outside the project root');
  }
  return resolved;
}

export function parseInternalSkillFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { name: 'Unknown', description: 'No description found' };

  let name = 'Unknown';
  let description = 'No description found';

  const lines = match[1].split('\n');
  lines.forEach((line) => {
    if (line.startsWith('name:'))
      name = line
        .replace('name:', '')
        .trim()
        .replace(/^['"](.*)['"]$/, '$1');
    if (line.startsWith('description:')) {
      description = line
        .replace('description:', '')
        .trim()
        .replace(/^['"](.*)['"]$/, '$1');
    }
  });

  return { name, description };
}

export function createNativeToolExecutor({ projectRoot, skillsDir, getBraveApiKey }) {
  async function readFileTool(args) {
    const { filePath } = args;

    const resolvedPath = resolveSafePath(projectRoot, filePath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const stats = fs.statSync(resolvedPath);
    if (!stats.isFile()) {
      throw new Error(`Path is not a file: ${filePath}`);
    }

    const content = fs.readFileSync(resolvedPath, 'utf8');
    return { content };
  }

  async function braveSearchTool(args) {
    const { query } = args;

    const apiKey = getBraveApiKey();
    if (!apiKey) {
      throw new Error('BRAVE_API_KEY is not set in backend .env');
    }

    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`,
      {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': apiKey,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Brave Search API error: ${response.status}`);
    }

    const data = await response.json();

    const results =
      data.web?.results?.slice(0, 5).map((result) => ({
        title: result.title,
        url: result.url,
        description: result.description,
      })) ?? [];

    return { results };
  }

  async function loadSkillTool(args) {
    const { skillName } = args;

    const safeSkillName = path.basename(skillName);
    const skillMdPath = path.join(skillsDir, safeSkillName, 'SKILL.md');

    if (!fs.existsSync(skillMdPath)) {
      throw new Error(`Skill '${safeSkillName}' not found or has no SKILL.md`);
    }

    const content = fs.readFileSync(skillMdPath, 'utf8');
    return { content };
  }

  const toolMap = {
    read_file: readFileTool,
    brave_search: braveSearchTool,
    load_skill: loadSkillTool,
  };

  return {
    isNativeTool(toolName) {
      return Boolean(toolMap[toolName]);
    },
    listToolDefinitions() {
      return NATIVE_TOOL_DEFINITIONS;
    },
    async execute(toolName, args) {
      const handler = toolMap[toolName];
      if (!handler) {
        throw new Error(`Unsupported native tool: ${toolName}`);
      }

      const validated = validateToolArgs(toolName, args);
      return handler(validated);
    },
  };
}
