// lib/session.ts
// Stateful conversation sessions, stored in Firestore.
// Each admin (telegram id) has a single session doc; state drives the conversation flow.

import { db, FieldValue } from './firebase';
import { logger } from './logger';

const COLLECTION = 'admin_sessions';

export type SessionState =
  | 'idle'
  | 'wallet:await_uid'
  | 'wallet:await_amount'
  | 'wallet:await_description'
  | 'wallet:await_confirm'
  | 'users:await_query'
  | 'withdraw:await_reject_reason'
  | 'deposit:await_reject_reason'
  | 'broadcast:await_content'
  | 'broadcast:await_confirm'
  | 'poker:await_kick_uid'
  | 'ai:await_prompt';

export interface SessionData {
  telegramId: number;
  chatId: number;
  state: SessionState;
  // Scratch context — freeform typed loosely because it's flow-specific.
  context: Record<string, unknown>;
  updatedAt: number;
}

function ref(telegramId: number) {
  return db().collection(COLLECTION).doc(String(telegramId));
}

export const sessionStore = {
  async get(telegramId: number): Promise<SessionData | null> {
    const snap = await ref(telegramId).get();
    if (!snap.exists) return null;
    return snap.data() as SessionData;
  },

  async set(telegramId: number, chatId: number, state: SessionState, context: Record<string, unknown> = {}): Promise<void> {
    const data: SessionData = {
      telegramId, chatId, state, context, updatedAt: Date.now(),
    };
    await ref(telegramId).set(data, { merge: false });
  },

  async update(telegramId: number, patch: Partial<Omit<SessionData, 'telegramId'>>): Promise<void> {
    await ref(telegramId).set({ ...patch, updatedAt: Date.now() }, { merge: true });
  },

  async mergeContext(telegramId: number, patch: Record<string, unknown>): Promise<void> {
    const existing = await sessionStore.get(telegramId);
    const merged   = { ...(existing?.context || {}), ...patch };
    await ref(telegramId).set({ context: merged, updatedAt: Date.now() }, { merge: true });
  },

  async clear(telegramId: number): Promise<void> {
    try {
      await ref(telegramId).delete();
    } catch (err) {
      logger.warn('session.clear.failed', { telegramId, error: (err as Error).message });
    }
  },

  async setState(telegramId: number, chatId: number, state: SessionState): Promise<void> {
    await ref(telegramId).set({ telegramId, chatId, state, updatedAt: Date.now() }, { merge: true });
  },
};

/** Idempotency store keyed by an arbitrary key (used for wallet ops). */
const IDEM_COLLECTION = 'admin_idempotency';

export const idempotencyStore = {
  async check(key: string): Promise<{ exists: boolean; result?: unknown }> {
    const s = await db().collection(IDEM_COLLECTION).doc(key).get();
    if (!s.exists) return { exists: false };
    return { exists: true, result: (s.data() || {}).result };
  },
  async save(key: string, result: unknown): Promise<void> {
    await db().collection(IDEM_COLLECTION).doc(key).set({
      key, result, createdAt: FieldValue.serverTimestamp(),
    });
  },
};
