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
          [SEND]
        </button>
      </div>
    </form>
  );
}
