import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KEY_FILE = path.join(__dirname, 'src', 'test01');
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

async function runTest() {
    console.log('--- OpenRouter Connectivity Test ---');

    // 1. Read API Key
    if (!fs.existsSync(KEY_FILE)) {
        console.error(`Error: Key file not found at ${KEY_FILE}`);
        process.exit(1);
    }

    const apiKey = fs.readFileSync(KEY_FILE, 'utf8').trim().replace(/\.$/, '');
    if (!apiKey) {
        console.error('Error: API key is empty in src/test01');
        process.exit(1);
    }

    console.log('✅ API key loaded (redacted):', apiKey.slice(0, 8) + '...');

    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:5173',
        'X-OpenRouter-Title': 'Local Chat UI Test',
        'Content-Type': 'application/json'
    };

    try {
        // 2. List Models
        console.log('Fetching models from OpenRouter...');
        const modelsResponse = await fetch('https://openrouter.ai/api/v1/models', { headers });
        if (!modelsResponse.ok) {
            const errorText = await modelsResponse.text();
            throw new Error(`Failed to fetch models (${modelsResponse.status}): ${errorText}`);
        }
        const modelsData = await modelsResponse.json();
        console.log(`✅ Successfully fetched ${modelsData.data?.length || 0} models.`);

        // 3. Simple Completion
        console.log(`Attempting completion with ${DEFAULT_MODEL}...`);
        const chatResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: DEFAULT_MODEL,
                messages: [{ role: 'user', content: 'Say "OpenRouter Connected!"' }],
                max_tokens: 20
            })
        });

        if (!chatResponse.ok) {
            const errorText = await chatResponse.text();
            throw new Error(`Chat completion failed (${chatResponse.status}): ${errorText}`);
        }

        const chatData = await chatResponse.json();
        const reply = chatData.choices?.[0]?.message?.content;

        if (reply) {
            console.log('--- TEST SUCCESS ---');
            console.log('Response:', reply);
            console.log('--------------------');
        } else {
            console.warn('⚠️ No reply content found in response.');
            console.log('Full response:', JSON.stringify(chatData, null, 2));
        }

    } catch (error) {
        console.error('❌ Test Failed:', error.message);
    }
}

runTest();
