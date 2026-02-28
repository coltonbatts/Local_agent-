import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname);

const app = express();
const PORT = process.env.PORT || 3001;

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5174,http://127.0.0.1:5174')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
    }
}));
app.use(express.json({ limit: '1mb' }));

const toolApiKey = process.env.TOOL_API_KEY;
const requireToolAuth = (req, res, next) => {
    if (!toolApiKey) return next();
    const provided = req.header('x-tool-api-key');
    if (provided !== toolApiKey) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    return next();
};

const resolveSafePath = (inputPath) => {
    const normalized = path.normalize(inputPath);
    const resolved = path.resolve(PROJECT_ROOT, normalized);
    const relative = path.relative(PROJECT_ROOT, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Path is outside the project root');
    }
    return resolved;
};

// --- Tool 1: File System Access ---
app.post('/api/tools/read_file', requireToolAuth, async (req, res) => {
    try {
        const { filePath } = req.body;
        if (!filePath) {
            return res.status(400).json({ error: 'filePath is required' });
        }

        // Resolve path relative to project root and prevent traversal
        const resolvedPath = resolveSafePath(filePath);

        // Check if path exists and is a file
        if (!fs.existsSync(resolvedPath)) {
            return res.status(404).json({ error: `File not found: ${filePath}` });
        }

        const stats = fs.statSync(resolvedPath);
        if (!stats.isFile()) {
            return res.status(400).json({ error: `Path is not a file: ${filePath}` });
        }

        const content = fs.readFileSync(resolvedPath, 'utf-8');
        res.json({ content });
    } catch (err) {
        console.error('File Read Error:', err);
        res.status(500).json({ error: err.message || 'Error reading file' });
    }
});

// --- Tool 2: Brave Search API ---
app.post('/api/tools/brave_search', requireToolAuth, async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) {
            return res.status(400).json({ error: 'query is required' });
        }

        const apiKey = process.env.BRAVE_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'BRAVE_API_KEY is not set in backend .env' });
        }

        const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`, {
            headers: {
                'Accept': 'application/json',
                'X-Subscription-Token': apiKey
            }
        });

        if (!response.ok) {
            throw new Error(`Brave Search API error: ${response.status}`);
        }

        const data = await response.json();

        // Extract a condensed summary of the top results for the LLM
        const results = data.web?.results?.slice(0, 5).map(result => ({
            title: result.title,
            url: result.url,
            description: result.description,
        })) || [];

        res.json({ results });
    } catch (err) {
        console.error('Brave Search Error:', err);
        res.status(500).json({ error: err.message || 'Error executing search' });
    }
});

// --- skills.sh Integration ---
const SKILLS_DIR = path.join(__dirname, '.agents', 'skills');

// Helper to extract frontmatter from SKILL.md
const parseInternalSkillFrontmatter = (content) => {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return { name: 'Unknown', description: 'No description found' };

    let name = 'Unknown';
    let description = 'No description found';

    const lines = match[1].split('\n');
    lines.forEach(line => {
        if (line.startsWith('name:')) name = line.replace('name:', '').trim().replace(/^['"](.*)['"]$/, '$1');
        if (line.startsWith('description:')) description = line.replace('description:', '').trim().replace(/^['"](.*)['"]$/, '$1');
    });

    return { name, description };
};

// GET all available skills
app.get('/api/skills', (req, res) => {
    try {
        if (!fs.existsSync(SKILLS_DIR)) {
            return res.json({ skills: [] }); // No skills installed
        }

        const skillFolders = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory() || dirent.isSymbolicLink())
            .map(dirent => dirent.name);

        const skills = [];
        for (const folder of skillFolders) {
            const skillMdPath = path.join(SKILLS_DIR, folder, 'SKILL.md');
            if (fs.existsSync(skillMdPath)) {
                // Read symlinked file or regular file content
                const content = fs.readFileSync(skillMdPath, 'utf8');
                const metadata = parseInternalSkillFrontmatter(content);
                skills.push({ ...metadata, folderName: folder });
            }
        }

        res.json({ skills });
    } catch (err) {
        console.error('List Skills Error:', err);
        res.status(500).json({ error: err.message || 'Error listing skills' });
    }
});

// POST to load specific skill content
app.post('/api/tools/load_skill', requireToolAuth, (req, res) => {
    try {
        const { skillName } = req.body;
        if (!skillName) {
            return res.status(400).json({ error: 'skillName is required' });
        }

        // Ensure the path stays within the skills directory for security
        const safeSkillName = path.basename(skillName);
        const skillMdPath = path.join(SKILLS_DIR, safeSkillName, 'SKILL.md');

        if (!fs.existsSync(skillMdPath)) {
            return res.status(404).json({ error: `Skill '${safeSkillName}' not found or has no SKILL.md` });
        }

        const content = fs.readFileSync(skillMdPath, 'utf8');
        res.json({ content });

    } catch (err) {
        console.error('Load Skill Error:', err);
        res.status(500).json({ error: err.message || 'Error loading skill' });
    }
});

// --- Chat Persistence ---
const CHATS_DIR = path.join(__dirname, 'chats');
if (!fs.existsSync(CHATS_DIR)) {
    fs.mkdirSync(CHATS_DIR);
}

// Save a chat session
app.post('/api/chats', requireToolAuth, (req, res) => {
    try {
        const { messages, title } = req.body;
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: 'messages array is required' });
        }

        const now = new Date();
        const timestamp = now.toISOString();
        const safeTimestamp = timestamp.replace(/[:.]/g, '-');
        // create a safe filename
        const safeTitle = (title || 'chat').replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const filename = `${safeTimestamp}_${safeTitle}.json`;
        const filepath = path.join(CHATS_DIR, filename);

        fs.writeFileSync(filepath, JSON.stringify({ messages, title, timestamp }, null, 2));
        res.json({ success: true, filename });
    } catch (err) {
        console.error('Save Chat Error:', err);
        res.status(500).json({ error: err.message || 'Error saving chat' });
    }
});

// Load all saved chats (metadata)
app.get('/api/chats', (req, res) => {
    try {
        const files = fs.readdirSync(CHATS_DIR).filter(f => f.endsWith('.json'));
        const chats = files.map(file => {
            const filepath = path.join(CHATS_DIR, file);
            try {
                const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
                return {
                    filename: file,
                    title: data.title || 'Untitled Chat',
                    timestamp: data.timestamp || fs.statSync(filepath).mtime,
                };
            } catch (e) {
                return null;
            }
        }).filter(c => c !== null).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        res.json({ chats });
    } catch (err) {
        console.error('Load Chats Error:', err);
        res.status(500).json({ error: err.message || 'Error loading chats' });
    }
});

// Load a specific chat file
app.get('/api/chats/:filename', (req, res) => {
    try {
        const { filename } = req.params;
        const safeFilename = path.basename(filename);
        if (safeFilename !== filename || !safeFilename.endsWith('.json')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }
        const filepath = path.join(CHATS_DIR, safeFilename);

        if (!fs.existsSync(filepath)) {
            return res.status(404).json({ error: 'Chat file not found' });
        }

        const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
        res.json(data);
    } catch (err) {
        console.error('Load Chat Error:', err);
        res.status(500).json({ error: err.message || 'Error loading chat file' });
    }
});

app.listen(PORT, () => {
    console.log(`Tool Execution Server running on http://localhost:${PORT}`);
});
