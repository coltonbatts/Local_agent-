import type { FormEventHandler, KeyboardEventHandler } from 'react';

interface ChatInputProps {
  input: string;
  isGenerating: boolean;
  onInputChange: (value: string) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
}

export function ChatInput({ input, isGenerating, onInputChange, onSubmit, onKeyDown }: ChatInputProps) {
  return (
    <form className="input-area" onSubmit={onSubmit}>
      <div className="input-container">
        <textarea
          className="chat-input"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message local model..."
          disabled={isGenerating}
          rows={1}
        />
        <button
          type="submit"
          className="send-button"
          disabled={!input.trim() || isGenerating}
        >
          <svg className="send-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M22 2L15 22L11 13L2 9L22 2Z" fill="currentColor" />
          </svg>
        </button>
      </div>
    </form>
  );
}
