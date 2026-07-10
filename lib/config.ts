// lib/config.ts
// Centralized, validated environment configuration.

function req(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`[config] Missing required environment variable: ${name}`);
  }
  return v.trim();
}

function opt(name: string, fallback = ''): string {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : fallback;
}

function parseAdminIds(): number[] {
  const primary = req('ADMIN_TELEGRAM_ID');
  const extra   = opt('ADMIN_TELEGRAM_IDS');
  const list    = [primary, ...extra.split(',')]
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => Number(s))
    .filter(n => Number.isFinite(n) && n > 0);
  return Array.from(new Set(list));
}

function normalizePrivateKey(raw: string): string {
  // Vercel stores env vars as single-line; we accept escaped \n.
  if (raw.includes('\\n')) return raw.replace(/\\n/g, '\n');
  return raw;
}

export const config = {
  telegram: {
    botToken:       req('TELEGRAM_BOT_TOKEN'),
    webhookSecret:  opt('TELEGRAM_WEBHOOK_SECRET'),
    adminIds:       parseAdminIds(),
    apiBase:        'https://api.telegram.org',
  },
  admin: {
    secret: req('ADMIN_SECRET'),
  },
  firebase: {
    projectId:   req('FIREBASE_PROJECT_ID'),
    clientEmail: req('FIREBASE_CLIENT_EMAIL'),
    privateKey:  normalizePrivateKey(req('FIREBASE_PRIVATE_KEY')),
  },
  openrouter: {
    apiKey:  opt('OPENROUTER_API_KEY'),
    model:   opt('OPENROUTER_MODEL', 'openai/gpt-4o-mini'),
    siteUrl: opt('OPENROUTER_SITE_URL', 'https://vercel.app'),
    siteName:opt('OPENROUTER_SITE_NAME', 'Telegram Admin Backend'),
    apiBase: 'https://openrouter.ai/api/v1',
  },
  runtime: {
    nodeEnv: opt('NODE_ENV', 'production'),
    logLevel: opt('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error',
  },
} as const;

export type AppConfig = typeof config;
