/**
 * Shared tool layer – type definitions.
 */

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type NativeToolName = 'read_file' | 'brave_search' | 'load_skill';

/** Native tool names + MCP namespaced tools (mcp.server_id.tool_name) */
export type ToolName = NativeToolName | string;

export const NATIVE_TOOL_DEFINITIONS: ToolDefinition[];
export const NATIVE_TOOL_NAMES: readonly NativeToolName[];

export function validateToolArgs(
  toolName: NativeToolName,
  args: unknown,
): Record<string, unknown>;
