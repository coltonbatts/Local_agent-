/**
 * Shared tool layer – single source of truth for native tool definitions.
 * Backend is authoritative; frontend renders what backend reports via /api/tools/definitions.
 */
import { z } from 'zod';

export const NATIVE_TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file on the local file system.',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'The absolute or relative path to the file to read.',
          },
        },
        required: ['filePath'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'brave_search',
      description:
        'Search the web using the Brave Search API. Use this to find current information, news, or answer questions requiring internet access.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'load_skill',
      description: 'Load the instructions (SKILL.md) for a specific agent skill.',
      parameters: {
        type: 'object',
        properties: {
          skillName: {
            type: 'string',
            description: "The name of the skill to load (e.g., 'vercel-react-best-practices').",
          },
        },
        required: ['skillName'],
      },
    },
  },
];

// Zod schemas for native tool argument validation
const readFileSchema = z.object({
  filePath: z.string().min(1, 'filePath is required'),
});

const braveSearchSchema = z.object({
  query: z.string().min(1, 'query is required'),
});

const loadSkillSchema = z.object({
  skillName: z.string().min(1, 'skillName is required'),
});

const nativeToolSchemas = {
  read_file: readFileSchema,
  brave_search: braveSearchSchema,
  load_skill: loadSkillSchema,
};

export const NATIVE_TOOL_NAMES = /** @type {const} */ (Object.keys(nativeToolSchemas));

/**
 * Validates args for a native tool. Throws ZodError if invalid.
 * @param {string} toolName - Native tool name (read_file, brave_search, load_skill)
 * @param {unknown} args - Raw args (typically from JSON.parse)
 * @returns {Record<string, unknown>} Validated args
 */
export function validateToolArgs(toolName, args) {
  const schema = nativeToolSchemas[toolName];
  if (!schema) {
    throw new Error(`Unknown native tool: ${toolName}`);
  }
  return schema.parse(args);
}
