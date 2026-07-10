// lib/ai.ts
// OpenRouter-backed AI service for chat / code / logs / debug.

import { config } from './config';
import { httpRequest } from './http';
import { logger } from './logger';
import { truncate } from './utils';
import { adminLogs } from './logs';

export type AiMode = 'chat' | 'code' | 'logs' | 'debug';

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenRouterResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

const SYSTEM_PROMPTS: Record<AiMode, string> = {
  chat:  'You are a concise, helpful admin assistant for a gaming/wallet platform. Reply in plain text (no markdown). Under 400 words.',
  code:  'You are a senior TypeScript engineer. Return concise, production-ready code snippets with a one-line explanation. No filler.',
  logs:  'You are an SRE analyzing production logs. Identify anomalies, errors, and next actions in a short bulleted list.',
  debug: 'You are a debugging assistant. Given a problem description, propose the 3 most likely root causes and a minimal reproduction plan.',
};

export const aiService = {
  async ask(mode: AiMode, prompt: string, adminId: number): Promise<{ ok: true; reply: string } | { ok: false; error: string }> {
    if (!config.openrouter.apiKey) {
      return { ok: false, error: 'OpenRouter is not configured (missing OPENROUTER_API_KEY).' };
    }

    const trimmed = truncate(prompt, 6000);
    const messages: OpenRouterMessage[] = [
      { role: 'system', content: SYSTEM_PROMPTS[mode] },
      { role: 'user',   content: trimmed },
    ];

    try {
      const res = await httpRequest<OpenRouterResponse>(
        `${config.openrouter.apiBase}/chat/completions`,
        {
          method: 'POST',
          timeoutMs: 25_000,
          headers: {
            'Authorization': `Bearer ${config.openrouter.apiKey}`,
            'HTTP-Referer':  config.openrouter.siteUrl,
            'X-Title':       config.openrouter.siteName,
          },
          body: {
            model: config.openrouter.model,
            messages,
            temperature: mode === 'code' ? 0.2 : 0.5,
            max_tokens: 1024,
          },
        }
      );

      const reply = res.data?.choices?.[0]?.message?.content?.trim() ?? '';
      if (!reply) {
        const errMsg = res.data?.error?.message || 'Empty AI reply';
        await adminLogs.record({
          telegramId: adminId, module: 'ai', action: mode, result: 'failure', errorMessage: errMsg,
        });
        return { ok: false, error: errMsg };
      }

      await adminLogs.record({
        telegramId: adminId, module: 'ai', action: mode, result: 'success',
        description: truncate(trimmed, 200),
      });
      return { ok: true, reply };
    } catch (err) {
      const msg = (err as Error).message;
      logger.error('ai.ask.failed', { error: msg, mode });
      await adminLogs.record({
        telegramId: adminId, module: 'ai', action: mode, result: 'failure', errorMessage: msg,
      });
      return { ok: false, error: msg };
    }
  },
};
