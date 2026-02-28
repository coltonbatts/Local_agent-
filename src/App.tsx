import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ChatHeader } from './components/ChatHeader';
import { ChatHistorySidebar } from './components/ChatHistorySidebar';
import { ChatInput } from './components/ChatInput';
import { MessageList } from './components/MessageList';
import { MetricsSidebar } from './components/MetricsSidebar';
import {
  DEFAULT_OPENROUTER_APP_TITLE,
  DEFAULT_OPENROUTER_HTTP_REFERER,
  createLocalOpenAICompatibleProvider,
  createOpenRouterProvider,
  ProviderRequestError,
} from './providers';
import type {
  OpenRouterSettings,
  ProviderDebugInfo,
  ProviderId,
  ProviderModel,
} from './providers';
import type {
  ChatMetadata,
  McpServerConfig,
  McpToolsGroup,
  Message,
  Metrics,
  Skill,
  SkillsSyncState,
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

async function readJsonResponse<T = Record<string, unknown>>(
  res: Response,
  defaultError: string
): Promise<T> {
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
  const [skillsSyncState, setSkillsSyncState] = useState<SkillsSyncState | null>(null);
  const [modelName, setModelName] = useState('Local Model');
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('local');
  const [chats, setChats] = useState<ChatMetadata[]>([]);
  const [availableModels, setAvailableModels] = useState<ProviderModel[]>([]);
  const [lastProviderDebug, setLastProviderDebug] = useState<ProviderDebugInfo | null>(null);
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
  const localProvider = useMemo(() => createLocalOpenAICompatibleProvider(), []);
  const openRouterProvider = useMemo(() => createOpenRouterProvider(), []);

  const openRouterSettings = useMemo<OpenRouterSettings>(
    () => ({
      apiKey: config?.openrouter?.apiKey ?? '',
      httpReferer:
        config?.openrouter?.httpReferer?.trim() ||
        (typeof window !== 'undefined' ? window.location.origin : DEFAULT_OPENROUTER_HTTP_REFERER),
      appTitle: config?.openrouter?.appTitle?.trim() || DEFAULT_OPENROUTER_APP_TITLE,
    }),
    [config?.openrouter?.apiKey, config?.openrouter?.httpReferer, config?.openrouter?.appTitle]
  );

  const buildToolHeaders = useCallback(
    (withJson = false): HeadersInit => {
      const headers: Record<string, string> = {};
      if (withJson) {
        headers['Content-Type'] = 'application/json';
      }
      if (TOOL_API_KEY) {
        headers['x-tool-api-key'] = TOOL_API_KEY;
      }
      return headers;
    },
    [TOOL_API_KEY]
  );

  const fetchSkills = useCallback(async () => {
    try {
      const res = await fetch('/api/skills');
      const data = await res.json();
      if (data.skills) setAvailableSkills(data.skills);
      if (data.syncState) setSkillsSyncState(data.syncState);
    } catch (e) {
      console.error('Failed to load skills', e);
    }
  }, []);

  const getProviderClient = useCallback(
    (provider: ProviderId) => (provider === 'openrouter' ? openRouterProvider : localProvider),
    [localProvider, openRouterProvider]
  );

  const fetchModel = useCallback(async (forceRefresh = false, providerOverride?: ProviderId) => {
    const requestProvider = providerOverride ?? selectedProvider;
    const providerClient = getProviderClient(requestProvider);

    try {
      const result = await providerClient.listModels({
        forceRefresh,
        openRouterSettings,
      });
      setLastProviderDebug(result.debug);
      setAvailableModels(result.models);

      const modelIds = result.models.map((m) => m.id);
      if (modelIds.length === 0) {
        setModelName(requestProvider === 'openrouter' ? 'No OpenRouter models' : 'No Local models');
        return;
      }

      const preferredModel =
        config?.providerModelSelections?.[requestProvider] ??
        (requestProvider === config?.provider ? config.defaultModel : null);

      setModelName((prev) => {
        if (preferredModel && modelIds.includes(preferredModel)) {
          return preferredModel;
        }
        if (modelIds.includes(prev)) {
          return prev;
        }
        return modelIds[0];
      });
    } catch (e) {
      if (e instanceof ProviderRequestError) {
        setLastProviderDebug({
          provider: e.meta.provider,
          operation: 'models',
          endpoint:
            e.meta.endpoint ??
            (requestProvider === 'openrouter'
              ? 'https://openrouter.ai/api/v1/models'
              : '/v1/models'),
          status: e.meta.status,
          requestId: e.meta.requestId,
          headers: {},
          timestamp: new Date().toISOString(),
        });
      }
      setAvailableModels([]);
      console.error(`Failed to load ${requestProvider} models`, e);
    }
  }, [
    config?.defaultModel,
    config?.provider,
    config?.providerModelSelections,
    getProviderClient,
    openRouterSettings,
    selectedProvider,
  ]);

  const refreshModels = useCallback(
    (forceRefresh = true) => {
      void fetchModel(forceRefresh);
    },
    [fetchModel]
  );

  const testOpenRouterConnection = useCallback(
    async (settings: OpenRouterSettings) => {
      try {
        const result = await openRouterProvider.testConnection(settings);
        if (result.debug) {
          setLastProviderDebug(result.debug);
        }
        return result;
      } catch (error) {
        if (error instanceof ProviderRequestError) {
          setLastProviderDebug({
            provider: error.meta.provider,
            operation: 'test',
            endpoint: error.meta.endpoint ?? 'https://openrouter.ai/api/v1/auth/key',
            status: error.meta.status,
            requestId: error.meta.requestId,
            headers: {},
            timestamp: new Date().toISOString(),
          });
        }
        throw error;
      }
    },
    [openRouterProvider]
  );

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
    [buildToolHeaders]
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
          ? groupedToolsData.errors.map(
            (error: { server_id: string; error: string }) => `${error.server_id}: ${error.error}`
          )
          : []),
        ...(Array.isArray(definitionsData.errors)
          ? definitionsData.errors.map(
            (error: { server_id: string; error: string }) => `${error.server_id}: ${error.error}`
          )
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
    fetchChats();
    fetchConfig();
    void refreshTooling();
  }, [fetchSkills, fetchChats, fetchConfig, refreshTooling]);

  useEffect(() => {
    if (config?.provider) {
      setSelectedProvider(config.provider);
    }
  }, [config?.provider]);

  useEffect(() => {
    void fetchModel(false, selectedProvider);
  }, [fetchModel, selectedProvider]);

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

  // Scratchpad: persist to localStorage only when no project is loaded
  useEffect(() => {
    if (!hasLoadedPersistedMessages || isGenerating || currentChatFilename) return;
    try {
      const messagesToPersist = messages.filter((message) => message.role !== 'system');
      localStorage.setItem(LOCAL_STORAGE_MESSAGES_KEY, JSON.stringify(messagesToPersist));
    } catch (e) {
      console.error('Failed to persist scratchpad to localStorage', e);
    }
  }, [messages, isGenerating, hasLoadedPersistedMessages, currentChatFilename]);

  // Project autosave: when autosave is on and we have a project, debounced save to filesystem
  useEffect(() => {
    if (!config?.chatAutosave || !currentChatFilename || isGenerating || messages.length === 0)
      return;
    const t = setTimeout(async () => {
      try {
        const messagesToSave = messages.filter((message) => message.role !== 'system');
        const res = await fetch(`/api/chats/${currentChatFilename}`, {
          method: 'PUT',
          headers: buildToolHeaders(true),
          body: JSON.stringify({ messages: messagesToSave }),
        });
        if (!res.ok) throw new Error('Autosave failed');
      } catch (e) {
        console.error('Autosave failed', e);
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [messages, currentChatFilename, isGenerating, config?.chatAutosave, buildToolHeaders]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: isGenerating ? 'auto' : 'smooth' });
  }, [isGenerating]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const saveChat = async () => {
    if (messages.length === 0) return;
    const messagesToSave = messages.filter((m) => m.role !== 'system');
    const firstUserMsg = messages.find((m) => m.role === 'user')?.content || 'Untitled Chat';
    const title = firstUserMsg.substring(0, 40);

    try {
      if (currentChatFilename) {
        const res = await fetch(`/api/chats/${currentChatFilename}`, {
          method: 'PUT',
          headers: buildToolHeaders(true),
          body: JSON.stringify({ messages: messagesToSave, title }),
        });
        const data = await res.json();
        if (data.success) fetchChats();
      } else {
        const res = await fetch('/api/chats', {
          method: 'POST',
          headers: buildToolHeaders(true),
          body: JSON.stringify({ messages: messagesToSave, title }),
        });
        const data = await res.json();
        if (data.success) {
          fetchChats();
          setCurrentChatFilename(data.filename);
        }
      }
    } catch (e) {
      console.error('Failed to save chat', e);
    }
  };

  const saveChatAsNew = async () => {
    if (messages.length === 0) return;
    const messagesToSave = messages.filter((m) => m.role !== 'system');
    const firstUserMsg = messages.find((m) => m.role === 'user')?.content || 'Untitled Chat';
    const title = firstUserMsg.substring(0, 40);
    try {
      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: buildToolHeaders(true),
        body: JSON.stringify({ messages: messagesToSave, title }),
      });
      const data = await res.json();
      if (data.success) {
        fetchChats();
        setCurrentChatFilename(data.filename);
      }
    } catch (e) {
      console.error('Failed to save copy', e);
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

  const renameChat = useCallback(
    async (filename: string, newTitle: string) => {
      if (!newTitle.trim()) return;
      try {
        const res = await fetch(`/api/chats/${filename}`, {
          method: 'PUT',
          headers: buildToolHeaders(true),
          body: JSON.stringify({ title: newTitle.trim() }),
        });
        await readJsonResponse(res, 'Failed to rename chat');
        fetchChats();
      } catch (e) {
        console.error('Failed to rename chat', e);
      }
    },
    [buildToolHeaders, fetchChats]
  );

  const togglePinChat = useCallback(
    async (filename: string, pinned: boolean) => {
      try {
        const res = await fetch(`/api/chats/${filename}`, {
          method: 'PUT',
          headers: buildToolHeaders(true),
          body: JSON.stringify({ pinned }),
        });
        await readJsonResponse(res, 'Failed to pin chat');
        fetchChats();
      } catch (e) {
        console.error('Failed to pin chat', e);
      }
    },
    [buildToolHeaders, fetchChats]
  );

  const exportChat = useCallback(() => {
    const messagesToExport = messages.filter((m) => m.role !== 'system');
    const firstUserMsg = messagesToExport.find((m) => m.role === 'user')?.content || 'Untitled';
    const title = currentChatFilename
      ? (chats.find((c) => c.filename === currentChatFilename)?.title ??
        firstUserMsg.substring(0, 40))
      : firstUserMsg.substring(0, 40);
    const bundle = {
      title,
      timestamp: new Date().toISOString(),
      exportedAt: new Date().toISOString(),
      messages: messagesToExport,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chat-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [messages, currentChatFilename, chats]);

  const createNewChat = () => {
    if (isGenerating) return;
    setMessages([]);
    setCurrentChatFilename(null);
    setMetrics(createDefaultMetrics());
    localStorage.removeItem(LOCAL_STORAGE_MESSAGES_KEY);
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

    const skillsDesc = availableSkills
      .map((skill) => `- ${skill.name}: ${skill.description}`)
      .join('\n');
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

  const createMcpServer = useCallback(
    async (payload: Partial<McpServerConfig>) => {
      const res = await fetch('/api/mcp/servers', {
        method: 'POST',
        headers: buildToolHeaders(true),
        body: JSON.stringify(payload),
      });
      await readJsonResponse(res, 'Failed to create MCP server');
      await refreshTooling();
    },
    [buildToolHeaders, refreshTooling]
  );

  const updateMcpServer = useCallback(
    async (id: string, patch: Partial<McpServerConfig>) => {
      const res = await fetch(`/api/mcp/servers/${id}`, {
        method: 'PUT',
        headers: buildToolHeaders(true),
        body: JSON.stringify(patch),
      });
      await readJsonResponse(res, 'Failed to update MCP server');
      await refreshTooling();
    },
    [buildToolHeaders, refreshTooling]
  );

  const deleteMcpServer = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/mcp/servers/${id}`, {
        method: 'DELETE',
        headers: buildToolHeaders(),
      });
      await readJsonResponse(res, 'Failed to delete MCP server');
      await refreshTooling();
    },
    [buildToolHeaders, refreshTooling]
  );

  const testMcpServer = useCallback(
    async (id: string) => {
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
    },
    [buildToolHeaders, refreshTooling]
  );

  const replayToolCall = useCallback(
    async (eventId: string) => {
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
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `⚠️ Replay failed: ${errorMessage}` },
        ]);
      } finally {
        setReplayingEventId(null);
      }
    },
    [buildToolHeaders, isGenerating]
  );

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
        provider: selectedProvider,
        openRouterSettings,
        tools: toolDefinitions,
        toolApiKey: TOOL_API_KEY,
        temperature,
        maxTokens,
        toolsEnabled,
        onProviderDebug: (debug) => {
          setLastProviderDebug(debug);
        },
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
      console.error('Error connecting to model provider:', error);
      const providerLabel =
        selectedProvider === 'openrouter' ? 'OpenRouter provider' : 'Local provider';
      const providerHelp =
        selectedProvider === 'openrouter'
          ? 'Check your OpenRouter API key, selected model, and rate limits.'
          : 'Check if LM Studio has the model loaded and the server is running.';
      const providerError =
        error instanceof ProviderRequestError
          ? `${error.message}${error.meta.status ? ` (HTTP ${error.meta.status})` : ''}`
          : error instanceof Error
            ? error.message
            : 'Unknown connection error';
      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          role: 'assistant',
          content: `⚠️ ${providerLabel} error: ${providerError}. ${providerHelp}`,
        },
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleModelChange = useCallback(
    (nextModel: string) => {
      setModelName(nextModel);

      if (!config) return;

      const updatedSelections = {
        local: config.providerModelSelections?.local ?? null,
        openrouter: config.providerModelSelections?.openrouter ?? null,
      };
      updatedSelections[selectedProvider] = nextModel;

      void updateConfig({
        defaultModel: nextModel,
        providerModelSelections: updatedSelections,
      });
    },
    [config, selectedProvider, updateConfig]
  );

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
        onRenameChat={renameChat}
        onTogglePinChat={togglePinChat}
        onExportChat={exportChat}
        onSaveChat={saveChat}
        onSaveChatAsNew={saveChatAsNew}
        config={config}
        onConfigChange={updateConfig}
        hasMessages={messages.length > 0}
        isGenerating={isGenerating}
      />

      <main className="chat-area">
        <ChatHeader
          modelName={modelName}
          availableModels={availableModels}
          onModelChange={handleModelChange}
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
        onRefreshModels={refreshModels}
        onTestOpenRouterConnection={testOpenRouterConnection}
        lastProviderDebug={lastProviderDebug}
        mcpServers={mcpServers}
        mcpToolsGrouped={mcpToolsGrouped}
        mcpToolErrors={mcpToolErrors}
        isToolsLoading={isToolsLoading}
        onRefreshTools={refreshTooling}
        onCreateMcpServer={createMcpServer}
        onUpdateMcpServer={updateMcpServer}
        onDeleteMcpServer={deleteMcpServer}
        onTestMcpServer={testMcpServer}
        onReplayToolCall={replayToolCall}
        replayingEventId={replayingEventId}
        toolApiKey={TOOL_API_KEY}
        availableSkills={availableSkills}
        skillsSyncState={skillsSyncState}
        onSyncSkills={fetchSkills}
        onRefreshSkills={fetchSkills}
      />
    </div>
  );
}

export default App;
