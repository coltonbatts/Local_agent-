# Local Chat Model UI

A minimal React + Vite UI that talks to a local OpenAI-compatible model server (e.g. LM Studio) and a small Express tools server. It supports streaming, tool calls, and optional skill loading.

**Architecture**
1. Frontend (Vite + React) at `http://localhost:5173`
2. Model server (OpenAI-compatible) at `http://localhost:1234/v1`
3. Tools server (Express) at `http://localhost:3001`

**Run**
1. Install dependencies: `npm install`
2. Start your local model server on `http://localhost:1234`
3. Start the tools server and frontend:
   1. `npm run dev:backend`
   2. `npm run dev:frontend`

**Environment Variables**
- `BRAVE_API_KEY` (tools server): Enables `/api/tools/brave_search`
- `TOOL_API_KEY` (tools server): Optional shared secret for tool endpoints
- `CORS_ORIGINS` (tools server): Comma-separated list of allowed origins (default `http://localhost:5173`)
- `VITE_TOOL_API_KEY` (frontend): Optional client key to match `TOOL_API_KEY`

**Notes**
- `read_file` is restricted to the project root to avoid path traversal.
- Tool calls are executed on the tools server, then the model is called again with tool results.
- Chat persistence endpoints exist (`/api/chats`), but the UI does not currently expose save/load.

**Troubleshooting**
1. “Error connecting to local model” means `http://localhost:1234/v1` is not reachable.
2. Tool failures usually mean the tools server isn’t running or the API key does not match.
