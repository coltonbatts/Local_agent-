export interface ParsedContentPart {
  type: 'text' | 'think';
  content: string;
}

export function parseContentWithThoughts(content: string): ParsedContentPart[] {
  const parts: ParsedContentPart[] = [];
  const regex = /<think>([\s\S]*?)(?:<\/think>|$)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: content.substring(lastIndex, match.index) });
    }
    parts.push({ type: 'think', content: match[1] });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push({ type: 'text', content: content.substring(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ type: 'text', content }];
}
