// lib/withdraw.ts
// Withdrawal approval workflow. On approve → debits winningBalance via walletService.
// On reject → refunds the reserved amount (if any).

import { db, FieldValue } from './firebase';
import { walletService } from './wallet';
import { adminLogs } from './logs';
import { logger } from './logger';

const COLLECTION = 'withdrawals';

export type WithdrawStatus = 'pending' | 'approved' | 'rejected';

export interface WithdrawRequest {
  id: string;
  uid: string;
  amount: number;
  method: string;
  destination?: string;         // upi id / bank / wallet address
  status: WithdrawStatus;
  createdAt: number;
  processedAt?: number;
  processedBy?: number;
  rejectReason?: string;
  reservedAtCreation?: boolean;  // if funds were already debited when request was created
}

function mapWithdraw(id: string, data: Record<string, unknown>): WithdrawRequest {
  return {
    id,
    uid:                String(data.uid || ''),
    amount:             Number(data.amount || 0),
    method:             String(data.method || 'manual'),
    destination:        data.destination as string | undefined,
    status:             (data.status as WithdrawStatus) || 'pending',
    createdAt:          Number(data.createdAt || 0),
    processedAt:        Number(data.processedAt) || undefined,
    processedBy:        Number(data.processedBy) || undefined,
    rejectReason:       data.rejectReason as string | undefined,
    reservedAtCreation: Boolean(data.reservedAtCreation),
  };
}

export const withdrawService = {
  async pending(limit = 10): Promise<WithdrawRequest[]> {
    const q = await db()
      .collection(COLLECTION)
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    return q.docs.map(d => mapWithdraw(d.id, d.data()));
  },

  async history(limit = 20): Promise<WithdrawRequest[]> {
    const q = await db()
      .collection(COLLECTION)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    return q.docs.map(d => mapWithdraw(d.id, d.data()));
  },

  async get(id: string): Promise<WithdrawRequest | null> {
    const s = await db().collection(COLLECTION).doc(id).get();
    return s.exists ? mapWithdraw(s.id, s.data() || {}) : null;
  },

  async approve(id: string, adminId: number): Promise<{ ok: true } | { ok: false; error: string }> {
    const w = await this.get(id);
    if (!w) return { ok: false, error: 'Withdrawal not found' };
    if (w.status !== 'pending') return { ok: false, error: `Already ${w.status}` };

    // If funds were NOT already reserved, deduct now.
    if (!w.reservedAtCreation) {
      const result = await walletService.execute({
        uid: w.uid,
        action: 'DEDUCT',
        type: 'WITHDRAWAL',
        amount: w.amount,
        balanceType: 'winningBalance',
        description: `Withdrawal ${id} approved by admin ${adminId}`,
        idempotencyKey: `withdraw_${id}_approve`,
        performedBy: String(adminId),
        metadata: { withdrawalId: id, method: w.method },
      });
      if (!result.ok) {
        await adminLogs.record({
          telegramId: adminId, module: 'withdraw', action: 'approve',
          target: w.uid, amount: w.amount, result: 'failure', errorMessage: result.message,
        });
        return { ok: false, error: result.message };
      }
    }

    await db().collection(COLLECTION).doc(id).set({
      status: 'approved',
      processedAt: Date.now(),
      processedBy: adminId,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    await adminLogs.record({
      telegramId: adminId, module: 'withdraw', action: 'approve',
      target: w.uid, amount: w.amount, result: 'success',
      metadata: { withdrawalId: id },
    });
    logger.info('withdraw.approved', { id, uid: w.uid, amount: w.amount, adminId });
    return { ok: true };
  },

  async reject(id: string, adminId: number, reason: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const w = await this.get(id);
    if (!w) return { ok: false, error: 'Withdrawal not found' };
    if (w.status !== 'pending') return { ok: false, error: `Already ${w.status}` };

    // If reserved at creation, refund it back.
    if (w.reservedAtCreation) {
      const refund = await walletService.execute({
        uid: w.uid,
        action: 'ADD',
        type: 'REFUND',
        amount: w.amount,
        balanceType: 'winningBalance',
        description: `Withdrawal ${id} rejected — refund: ${reason}`,
        idempotencyKey: `withdraw_${id}_refund`,
        performedBy: String(adminId),
        metadata: { withdrawalId: id },
      });
      if (!refund.ok) {
        await adminLogs.record({
          telegramId: adminId, module: 'withdraw', action: 'reject',
          target: w.uid, amount: w.amount, result: 'failure',
          errorMessage: `Refund failed: ${refund.message}`,
        });
        return { ok: false, error: `Refund failed: ${refund.message}` };
      }
    }

    await db().collection(COLLECTION).doc(id).set({
      status: 'rejected',
      rejectReason: reason,
      processedAt: Date.now(),
      processedBy: adminId,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    await adminLogs.record({
      telegramId: adminId, module: 'withdraw', action: 'reject',
      target: w.uid, amount: w.amount, description: reason, result: 'success',
      metadata: { withdrawalId: id },
    });
    return { ok: true };
  },
};
