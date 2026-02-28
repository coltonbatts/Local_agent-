import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChatHeader } from './components/ChatHeader';
import { ChatHistorySidebar } from './components/ChatHistorySidebar';
import { ChatInput } from './components/ChatInput';
import { MessageList } from './components/MessageList';
import { MetricsSidebar } from './components/MetricsSidebar';
import type {
  ChatMetadata,
  McpServerConfig,
  McpToolsGroup,
  Message,
  Metrics,
  Skill,
  ToolCall,
  ToolDefinition,
  ToolExecutionEvent,
} from './types/chat';
import type { AppConfig } from './types/config';
import { runToolConversation } from './utils/chatGeneration';
import './App.css';

const LOCAL_STORAGE_MESSAGES_KEY = 'chatbot_messages';

function createDefaultMetrics(): Metrics {
  return {
    ttft: null,
    tokensPerSec: null,
    totalTokens: 0,
    totalLatency: null,
  };
}

async function readJsonResponse<T = Record<string, unknown>>(res: Response, defaultError: string): Promise<T> {
  const raw = await res.text();
  let data: Record<string, unknown> = {};

  if (raw.trim().length > 0) {
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      const snippet = raw.slice(0, 180).replace(/\s+/g, ' ');
      throw new Error(`${defaultError}. Non-JSON response (HTTP ${res.status}): ${snippet}`);
    }
  }

  if (!res.ok) {
    const backendError = typeof data.error === 'string' ? data.error : null;
    throw new Error(backendError || `${defaultError} (HTTP ${res.status})`);
  }

  return data as T;
}

interface ReplayToolResponse {
  event?: ToolExecutionEvent;
  result?: unknown;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasLoadedPersistedMessages, setHasLoadedPersistedMessages] = useState(false);
  const [metrics, setMetrics] = useState<Metrics>(createDefaultMetrics());
  const [availableSkills, setAvailableSkills] = useState<Skill[]>([]);
  const [modelName, setModelName] = useState('Local Model');
  const [chats, setChats] = useState<ChatMetadata[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [currentChatFilename, setCurrentChatFilename] = useState<string | null>(null);
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(false);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);
  const [toolDefinitions, setToolDefinitions] = useState<ToolDefinition[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [mcpToolsGrouped, setMcpToolsGrouped] = useState<McpToolsGroup[]>([]);
  const [mcpToolErrors, setMcpToolErrors] = useState<string[]>([]);
  const [isToolsLoading, setIsToolsLoading] = useState(false);
  const [replayingEventId, setReplayingEventId] = useState<string | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const TOOL_API_KEY = import.meta.env.VITE_TOOL_API_KEY as string | undefined;

  const buildToolHeaders = useCallback((withJson = false): HeadersInit => {
    const headers: Record<string, string> = {};
    if (withJson) {
      headers['Content-Type'] = 'application/json';
    }
    if (TOOL_API_KEY) {
      headers['x-tool-api-key'] = TOOL_API_KEY;
    }
    return headers;
  }, [TOOL_API_KEY]);

  const fetchSkills = useCallback(async () => {
    try {
      const res = await fetch('/api/skills');
      const data = await res.json();
      if (data.skills) setAvailableSkills(data.skills);
    } catch (e) {
      console.error('Failed to load skills', e);
    }
  }, []);

  const fetchModel = useCallback(async () => {
    try {
      const res = await fetch('/v1/models');
      const data = await res.json();
      if (data.data && data.data.length > 0) {
        const models = data.data.map((m: { id: string }) => m.id);
        setAvailableModels(models);
        if (modelName === 'Local Model' || !models.includes(modelName)) {
          setModelName(models[0]);
        }
      }
    } catch (e) {
      console.error('Failed to load model name', e);
    }
  }, [modelName]);

  const fetchChats = useCallback(async () => {
    try {
      const res = await fetch('/api/chats');
      const data = await res.json();
      if (data.chats) setChats(data.chats);
    } catch (e) {
      console.error('Failed to load chats', e);
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      if (data && typeof data === 'object') {
        setConfig(data as AppConfig);
      }
    } catch (e) {
      console.error('Failed to load config', e);
    }
  }, []);

  const updateConfig = useCallback(
    async (patch: Partial<AppConfig>) => {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: buildToolHeaders(true),
        body: JSON.stringify(patch),
      });
      const data = await readJsonResponse<AppConfig>(res, 'Failed to update config');
      setConfig(data);
      return data;
    },
    [buildToolHeaders],
  );

  const refreshTooling = useCallback(async () => {
    setIsToolsLoading(true);

    try {
      const [serversRes, groupedToolsRes, definitionsRes] = await Promise.all([
        fetch('/api/mcp/servers', { headers: buildToolHeaders() }),
        fetch('/api/mcp/tools', { headers: buildToolHeaders() }),
        fetch('/api/tools/definitions', { headers: buildToolHeaders() }),
      ]);

      const [serversData, groupedToolsData, definitionsData] = await Promise.all([
        readJsonResponse(serversRes, 'Failed to load MCP servers'),
        readJsonResponse(groupedToolsRes, 'Failed to load MCP tools'),
        readJsonResponse(definitionsRes, 'Failed to load model tool definitions'),
      ]);

      if (serversRes.ok && Array.isArray(serversData.servers)) {
        setMcpServers(serversData.servers);
      }

      if (groupedToolsRes.ok && Array.isArray(groupedToolsData.grouped)) {
        setMcpToolsGrouped(groupedToolsData.grouped);
      } else {
        setMcpToolsGrouped([]);
      }

      if (definitionsRes.ok && Array.isArray(definitionsData.tools)) {
        setToolDefinitions(definitionsData.tools);
      } else {
        setToolDefinitions([]);
      }

      const errors = [
        ...(Array.isArray(groupedToolsData.errors)
          ? groupedToolsData.errors.map((error: { server_id: string; error: string }) => `${error.server_id}: ${error.error}`)
          : []),
        ...(Array.isArray(definitionsData.errors)
          ? definitionsData.errors.map((error: { server_id: string; error: string }) => `${error.server_id}: ${error.error}`)
          : []),
      ];
      setMcpToolErrors(errors);
    } catch (error) {
      console.error('Failed to refresh MCP tooling', error);
      setToolDefinitions([]);
      setMcpToolsGrouped([]);
      const message = error instanceof Error ? error.message : 'Unable to fetch MCP tools';
      setMcpToolErrors([message]);
    } finally {
      setIsToolsLoading(false);
    }
  }, [buildToolHeaders]);

  useEffect(() => {
    fetchSkills();
    fetchModel();
    fetchChats();
    fetchConfig();
    void refreshTooling();
  }, [fetchSkills, fetchModel, fetchChats, fetchConfig, refreshTooling]);

  useEffect(() => {
    if (config?.defaultModel && availableModels.includes(config.defaultModel)) {
      setModelName(config.defaultModel);
    }
  }, [config?.defaultModel, availableModels]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_MESSAGES_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setMessages(parsed);
        }
      }
    } catch (e) {
      console.error('Failed to restore messages from localStorage', e);
    } finally {
      setHasLoadedPersistedMessages(true);
    }
  }, []);

  useEffect(() => {
    if (!hasLoadedPersistedMessages || isGenerating) return;
    try {
      const messagesToPersist = messages.filter((message) => message.role !== 'system');
      localStorage.setItem(LOCAL_STORAGE_MESSAGES_KEY, JSON.stringify(messagesToPersist));
    } catch (e) {
      console.error('Failed to persist messages to localStorage', e);
    }
  }, [messages, isGenerating, hasLoadedPersistedMessages]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: isGenerating ? 'auto' : 'smooth' });
  }, [isGenerating]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const saveChat = async () => {
    if (messages.length === 0) return;
    try {
      const firstUserMsg = messages.find((m) => m.role === 'user')?.content || 'Untitled Chat';
      const title = firstUserMsg.substring(0, 40);

      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: buildToolHeaders(true),
        body: JSON.stringify({ messages, title }),
      });
      const data = await res.json();
      if (data.success) {
        fetchChats();
        setCurrentChatFilename(data.filename);
      }
    } catch (e) {
      console.error('Failed to save chat', e);
    }
  };

  const loadChat = async (filename: string) => {
    if (isGenerating) return;
    try {
      const res = await fetch(`/api/chats/${filename}`);
      const data = await res.json();
      if (data.messages) {
        setMessages(data.messages);
        setCurrentChatFilename(filename);
      }
    } catch (e) {
      console.error('Failed to load chat', e);
    }
  };

  const createNewChat = () => {
    if (isGenerating) return;
    setMessages([]);
    setCurrentChatFilename(null);
    setMetrics(createDefaultMetrics());
  };

  const clearChat = () => {
    if (isGenerating) return;
    setMessages([]);
    setCurrentChatFilename(null);
    localStorage.removeItem(LOCAL_STORAGE_MESSAGES_KEY);
  };

  const buildRequestMessages = (newMessages: Message[]): Message[] => {
    const requestMessages = [...newMessages];

    if (availableSkills.length === 0) return requestMessages;

    const skillsDesc = availableSkills.map((skill) => `- ${skill.name}: ${skill.description}`).join('\n');
    const systemMsg: Message = {
      role: 'system',
      content:
        `You are a helpful AI assistant. You have access to the following skills (instructions) which you can read using the 'load_skill' tool:\n\n${skillsDesc}\n\n` +
        "When a user asks you to do a task that matches one of these skills, ALWAYS use the 'load_skill' tool to read its instructions before completing the task. Follow the instructions precisely.",
    };

    if (requestMessages[0]?.role !== 'system') {
      requestMessages.unshift(systemMsg);
    } else {
      requestMessages[0] = systemMsg;
    }

    return requestMessages;
  };

  const createMcpServer = useCallback(async (payload: Partial<McpServerConfig>) => {
    const res = await fetch('/api/mcp/servers', {
      method: 'POST',
      headers: buildToolHeaders(true),
      body: JSON.stringify(payload),
    });
    await readJsonResponse(res, 'Failed to create MCP server');
    await refreshTooling();
  }, [buildToolHeaders, refreshTooling]);

  const updateMcpServer = useCallback(async (id: string, patch: Partial<McpServerConfig>) => {
    const res = await fetch(`/api/mcp/servers/${id}`, {
      method: 'PUT',
      headers: buildToolHeaders(true),
      body: JSON.stringify(patch),
    });
    await readJsonResponse(res, 'Failed to update MCP server');
    await refreshTooling();
  }, [buildToolHeaders, refreshTooling]);

  const deleteMcpServer = useCallback(async (id: string) => {
    const res = await fetch(`/api/mcp/servers/${id}`, {
      method: 'DELETE',
      headers: buildToolHeaders(),
    });
    await readJsonResponse(res, 'Failed to delete MCP server');
    await refreshTooling();
  }, [buildToolHeaders, refreshTooling]);

  const testMcpServer = useCallback(async (id: string) => {
    const res = await fetch(`/api/mcp/servers/${id}/test`, {
      method: 'POST',
      headers: buildToolHeaders(true),
      body: JSON.stringify({}),
    });
    const data = await readJsonResponse(res, 'MCP server test failed');
    if (data.success !== true) {
      throw new Error(typeof data.error === 'string' ? data.error : 'MCP server test failed');
    }
    await refreshTooling();
    return {
      toolCount: Number(data.toolCount ?? 0),
      toolNames: Array.isArray(data.toolNames) ? data.toolNames : [],
    };
  }, [buildToolHeaders, refreshTooling]);

  const replayToolCall = useCallback(async (eventId: string) => {
    if (!eventId || isGenerating) return;

    setReplayingEventId(eventId);
    try {
      const res = await fetch(`/api/tools/replay/${eventId}`, {
        method: 'POST',
        headers: buildToolHeaders(true),
        body: JSON.stringify({}),
      });
      const data = await readJsonResponse<ReplayToolResponse>(res, 'Failed to replay tool call');

      const replayMessage: Message = {
        role: 'tool',
        tool_call_id: `replay_${Date.now()}`,
        name: data.event?.tool_name ?? 'tool_replay',
        content: JSON.stringify(data.result ?? {}),
        tool_event: data.event,
      };

      setMessages((prev) => [...prev, replayMessage]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown replay error';
      setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ Replay failed: ${errorMessage}` }]);
    } finally {
      setReplayingEventId(null);
    }
  }, [buildToolHeaders, isGenerating]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isGenerating) return;

    const userMessage: Message = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMessage];
    const requestMessages = buildRequestMessages(newMessages);

    setMessages(newMessages);
    setInput('');
    setIsGenerating(true);
    setMetrics(createDefaultMetrics());

    const profile = config?.profiles?.[config.activeProfile] ?? config?.profiles?.default;
    const temperature = profile?.temperature ?? config?.temperature ?? 0.7;
    const maxTokens = profile?.maxTokens ?? config?.maxTokens ?? 4096;
    const toolsEnabled = profile?.toolsEnabled ?? true;

    try {
      await runToolConversation({
        initialConversation: requestMessages,
        modelName: modelName,
        tools: toolDefinitions,
        toolApiKey: TOOL_API_KEY,
        temperature,
        maxTokens,
        toolsEnabled,
        callbacks: {
          appendEmptyAssistant: () => {
            setMessages((prev) => [...prev, { role: 'assistant', content: '', tool_calls: [] }]);
          },
          updateLastAssistant: (content: string, toolCalls?: ToolCall[]) => {
            setMessages((prev) => {
              const updated = [...prev];
              const lastMsg = updated[updated.length - 1];
              if (!lastMsg) return prev;
              updated[updated.length - 1] = {
                ...lastMsg,
                content,
                tool_calls: toolCalls,
              };
              return updated;
            });
          },
          appendMessage: (message: Message) => {
            setMessages((prev) => [...prev, message]);
          },
          appendAssistantWarning: (content: string) => {
            setMessages((prev) => [...prev, { role: 'assistant', content }]);
          },
          updateMetrics: (updater) => {
            setMetrics((prev) => updater(prev));
          },
        },
      });
    } catch (error) {
      console.error('Error connecting to local model:', error);
      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          role: 'assistant',
          content: `⚠️ Error: ${error instanceof Error ? error.message : 'Unknown error connecting to local model'}. Check if LM Studio has the model loaded and the server is running on port 1234.`,
        },
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  };

  return (
    <div className="app-container">
      <ChatHistorySidebar
        chats={chats}
        currentChatFilename={currentChatFilename}
        isOpen={isLeftSidebarOpen}
        onClose={() => setIsLeftSidebarOpen(false)}
        onCreateNewChat={createNewChat}
        onLoadChat={loadChat}
      />

      <main className="chat-area">
        <ChatHeader
          modelName={modelName}
          availableModels={availableModels}
          onModelChange={setModelName}
          isGenerating={isGenerating}
          hasMessages={messages.length > 0}
          onSaveChat={saveChat}
          onClearChat={clearChat}
          onToggleLeftSidebar={() => setIsLeftSidebarOpen(!isLeftSidebarOpen)}
          onToggleRightSidebar={() => setIsRightSidebarOpen(!isRightSidebarOpen)}
        />

        <MessageList
          messages={messages}
          isGenerating={isGenerating}
          messagesEndRef={messagesEndRef}
          onReplayToolCall={replayToolCall}
          replayingEventId={replayingEventId}
        />

        <div className="input-area">
          <ChatInput
            input={input}
            isGenerating={isGenerating}
            onInputChange={setInput}
            onSubmit={handleSubmit}
            onKeyDown={handleKeyDown}
          />
        </div>
      </main>

      <MetricsSidebar
        metrics={metrics}
        isGenerating={isGenerating}
        isOpen={isRightSidebarOpen}
        onClose={() => setIsRightSidebarOpen(false)}
        config={config}
        availableModels={availableModels}
        onConfigChange={updateConfig}
        onRefreshModels={fetchModel}
        mcpServers={mcpServers}
        mcpToolsGrouped={mcpToolsGrouped}
        mcpToolErrors={mcpToolErrors}
        isToolsLoading={isToolsLoading}
        onRefreshTools={refreshTooling}
        onCreateMcpServer={createMcpServer}
        onUpdateMcpServer={updateMcpServer}
        onDeleteMcpServer={deleteMcpServer}
        onTestMcpServer={testMcpServer}
      />
    </div>
  );
}

export default App;
