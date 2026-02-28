# Local Chat Model UI

A minimal React + Vite UI that talks to a local OpenAI-compatible model server (e.g. LM Studio, Ollama, llama.cpp) and a small Express tools server. It supports streaming, tool calls, MCP integration, and optional skill loading.

**Quick start:** `npm install` → `npm run doctor` (check setup) → `npm run dev:all`

**Architecture**

1. Frontend (Vite + React) at `http://localhost:5173`
2. Tools server (Express) at `http://localhost:3001` – proxies model requests to the configured engine
3. Model server (OpenAI-compatible) – URL configurable via Config panel (default `http://127.0.0.1:1234`)

**Run**

1. Install dependencies: `npm install`
2. Start your local model server (e.g. LM Studio on port 1234, or Ollama on 11434)
3. Start the tools server and frontend:
   1. `npm run dev:backend`
   2. `npm run dev:frontend`

**Config** (stored in `config/app-config.json`)

- **Model base URL** – LM Studio (`http://127.0.0.1:1234`), Ollama (`http://127.0.0.1:11434`), llama.cpp, OpenRouter, etc.
- **Default model** – Prefer a specific model when available
- **Profiles** – fast, accurate, vision, no-tools – presets for temperature, max tokens, and tool usage
- Edit via the Config section in the right sidebar (Inspector)

**Environment Variables** (see `example.env` – copy to `.env`)

- `BRAVE_API_KEY` (tools server): Enables `/api/tools/brave_search`
- `TOOL_API_KEY` (tools server): Optional shared secret for tool endpoints
- `CORS_ORIGINS` (tools server): Comma-separated list of allowed origins (default `http://localhost:5173`)
- `VITE_TOOL_API_KEY` (frontend): Optional client key to match `TOOL_API_KEY`

**Commands**

- `npm run format` – format code with Prettier
- `npm run test` – run unit tests (path sandboxing, MCP config, tool event redaction)
- `npm run doctor` – check model endpoint, tools server, Brave key, MCP servers

**Chat persistence**

- **Scratchpad** (localStorage): Unsaved working space. Persists in the browser only. Use "+ New" to start fresh.
- **Projects** (filesystem): Saved chats in `chats/`. Open the Chats sidebar (☰) to save, load, rename, pin, and export.
- **Autosave**: When a project is loaded, enable Autosave to write changes to disk automatically.
- **Export**: Download conversation + tool events as a single JSON bundle.

**Troubleshooting**

1. “Error connecting to local model” means Check Config panel: model base URL must match your engine (LM Studio: 1234, Ollama: 11434).
2. Tool failures usually mean the tools server isn’t running or the API key does not match.
