import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChatHeader } from './components/ChatHeader';
import { ChatHistorySidebar } from './components/ChatHistorySidebar';
import { ChatInput } from './components/ChatInput';
import { MessageList } from './components/MessageList';
import { MetricsSidebar } from './components/MetricsSidebar';
import type { ChatMetadata, Message, Metrics, Skill, ToolCall } from './types/chat';
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const TOOL_API_KEY = import.meta.env.VITE_TOOL_API_KEY as string | undefined;

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
        if (modelName === 'Local Model') {
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

  useEffect(() => {
    fetchSkills();
    fetchModel();
    fetchChats();
  }, [fetchSkills, fetchModel, fetchChats]);

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
        headers: {
          'Content-Type': 'application/json',
          ...(TOOL_API_KEY ? { 'x-tool-api-key': TOOL_API_KEY } : {}),
        },
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

    try {
      await runToolConversation({
        initialConversation: requestMessages,
        modelName: modelName,
        toolApiKey: TOOL_API_KEY,
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
      />
    </div>
  );
}

export default App;
