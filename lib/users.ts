// lib/users.ts
// User service: search by email/phone/uid, ban/unban, load recent games/transactions.

import { db, auth, FieldValue } from './firebase';
import { walletService } from './wallet';
import { logger } from './logger';
import { isEmail, isPhone } from './validators';
import type { UserRecord, UserStatus } from '../types/user';
import type { WalletTransaction } from '../types/wallet';

const COLLECTION = 'users';

function mapUser(uid: string, data: Record<string, unknown>): UserRecord {
  const s = String(data.status || 'active') as UserStatus;
  return {
    uid,
    displayName: (data.displayName as string) || (data.name as string),
    email:       data.email as string | undefined,
    phone:       data.phone as string | undefined,
    photoURL:    data.photoURL as string | undefined,
    status:      s,
    createdAt:   Number(data.createdAt) || 0,
    lastLoginAt: Number(data.lastLoginAt) || undefined,
    isAdmin:     Boolean(data.isAdmin),
    banReason:   data.banReason as string | undefined,
    banAt:       Number(data.banAt) || undefined,
  };
}

export const usersService = {
  async findByUid(uid: string): Promise<UserRecord | null> {
    const snap = await db().collection(COLLECTION).doc(uid).get();
    if (!snap.exists) {
      // Fallback to Firebase Auth so admins can look up unmirrored accounts.
      try {
        const u = await auth().getUser(uid);
        return {
          uid: u.uid,
          displayName: u.displayName,
          email: u.email,
          phone: u.phoneNumber,
          photoURL: u.photoURL,
          status: u.disabled ? 'suspended' : 'active',
          createdAt: Date.parse(u.metadata.creationTime) || 0,
          lastLoginAt: u.metadata.lastSignInTime ? Date.parse(u.metadata.lastSignInTime) : undefined,
        };
      } catch {
        return null;
      }
    }
    return mapUser(snap.id, snap.data() || {});
  },

  async findByEmail(email: string): Promise<UserRecord | null> {
    const q = await db().collection(COLLECTION).where('email', '==', email).limit(1).get();
    if (!q.empty) {
      const d = q.docs[0]!;
      return mapUser(d.id, d.data());
    }
    try {
      const u = await auth().getUserByEmail(email);
      return this.findByUid(u.uid);
    } catch {
      return null;
    }
  },

  async findByPhone(phone: string): Promise<UserRecord | null> {
    const q = await db().collection(COLLECTION).where('phone', '==', phone).limit(1).get();
    if (!q.empty) {
      const d = q.docs[0]!;
      return mapUser(d.id, d.data());
    }
    try {
      const u = await auth().getUserByPhoneNumber(phone);
      return this.findByUid(u.uid);
    } catch {
      return null;
    }
  },

  async search(query: string): Promise<UserRecord | null> {
    const q = query.trim();
    if (!q) return null;
    if (isEmail(q)) return this.findByEmail(q);
    if (isPhone(q)) return this.findByPhone(q);
    return this.findByUid(q);
  },

  async ban(uid: string, reason: string, adminId: number): Promise<void> {
    await db().collection(COLLECTION).doc(uid).set({
      status: 'banned',
      banReason: reason,
      banAt: Date.now(),
      bannedBy: adminId,
    }, { merge: true });
    try { await auth().updateUser(uid, { disabled: true }); } catch (err) {
      logger.warn('users.ban.auth_update_failed', { uid, error: (err as Error).message });
    }
  },

  async unban(uid: string, adminId: number): Promise<void> {
    await db().collection(COLLECTION).doc(uid).set({
      status: 'active',
      banReason: FieldValue.delete(),
      banAt: FieldValue.delete(),
      unbannedBy: adminId,
      unbanAt: Date.now(),
    }, { merge: true });
    try { await auth().updateUser(uid, { disabled: false }); } catch (err) {
      logger.warn('users.unban.auth_update_failed', { uid, error: (err as Error).message });
    }
  },

  async recentTransactions(uid: string, limit = 10): Promise<WalletTransaction[]> {
    return walletService.transactions(uid, limit);
  },

  async recentGames(uid: string, limit = 10): Promise<Array<{ id: string; game: string; result: string; amount: number; at: number }>> {
    // Best-effort read from a "game_results" collection if it exists.
    try {
      const q = await db()
        .collection('game_results')
        .where('uid', '==', uid)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      return q.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          game: String(data.game || 'unknown'),
          result: String(data.result || ''),
          amount: Number(data.amount || 0),
          at: Number(data.createdAt || 0),
        };
      });
    } catch {
      return [];
    }
  },
};
