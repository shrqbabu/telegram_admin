// lib/deposit.ts
// Deposit approval workflow. On approve → credits depositBalance via walletService.

import { db, FieldValue } from './firebase';
import { walletService } from './wallet';
import { adminLogs } from './logs';
import { logger } from './logger';
import { makeIdempotencyKey } from './utils';

const COLLECTION = 'deposits';

export type DepositStatus = 'pending' | 'approved' | 'rejected';

export interface DepositRequest {
  id: string;
  uid: string;
  amount: number;
  method: string;
  reference?: string;
  screenshotUrl?: string;
  status: DepositStatus;
  createdAt: number;
  processedAt?: number;
  processedBy?: number;
  rejectReason?: string;
}

function mapDeposit(id: string, data: Record<string, unknown>): DepositRequest {
  return {
    id,
    uid:            String(data.uid || ''),
    amount:         Number(data.amount || 0),
    method:         String(data.method || 'manual'),
    reference:      data.reference as string | undefined,
    screenshotUrl:  data.screenshotUrl as string | undefined,
    status:         (data.status as DepositStatus) || 'pending',
    createdAt:      Number(data.createdAt || 0),
    processedAt:    Number(data.processedAt) || undefined,
    processedBy:    Number(data.processedBy) || undefined,
    rejectReason:   data.rejectReason as string | undefined,
  };
}

export const depositService = {
  async pending(limit = 10): Promise<DepositRequest[]> {
    const q = await db()
      .collection(COLLECTION)
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    return q.docs.map(d => mapDeposit(d.id, d.data()));
  },

  async history(limit = 20): Promise<DepositRequest[]> {
    const q = await db()
      .collection(COLLECTION)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    return q.docs.map(d => mapDeposit(d.id, d.data()));
  },

  async get(id: string): Promise<DepositRequest | null> {
    const s = await db().collection(COLLECTION).doc(id).get();
    return s.exists ? mapDeposit(s.id, s.data() || {}) : null;
  },

  async approve(id: string, adminId: number): Promise<{ ok: true } | { ok: false; error: string }> {
    const dep = await this.get(id);
    if (!dep) return { ok: false, error: 'Deposit not found' };
    if (dep.status !== 'pending') return { ok: false, error: `Already ${dep.status}` };

    const result = await walletService.execute({
      uid: dep.uid,
      action: 'ADD',
      type: 'DEPOSIT',
      amount: dep.amount,
      balanceType: 'depositBalance',
      description: `Deposit ${id} approved by admin ${adminId}`,
      idempotencyKey: `deposit_${id}_approve`,
      performedBy: String(adminId),
      metadata: { depositId: id, method: dep.method },
    });

    if (!result.ok) {
      await adminLogs.record({
        telegramId: adminId, module: 'deposit', action: 'approve',
        target: dep.uid, amount: dep.amount, result: 'failure', errorMessage: result.message,
      });
      return { ok: false, error: result.message };
    }

    await db().collection(COLLECTION).doc(id).set({
      status: 'approved',
      processedAt: Date.now(),
      processedBy: adminId,
      walletTxId: result.txId,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    await adminLogs.record({
      telegramId: adminId, module: 'deposit', action: 'approve',
      target: dep.uid, amount: dep.amount, result: 'success',
      metadata: { depositId: id, txId: result.txId },
    });

    logger.info('deposit.approved', { id, uid: dep.uid, amount: dep.amount, adminId });
    return { ok: true };
  },

  async reject(id: string, adminId: number, reason: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const dep = await this.get(id);
    if (!dep) return { ok: false, error: 'Deposit not found' };
    if (dep.status !== 'pending') return { ok: false, error: `Already ${dep.status}` };

    await db().collection(COLLECTION).doc(id).set({
      status: 'rejected',
      rejectReason: reason,
      processedAt: Date.now(),
      processedBy: adminId,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    await adminLogs.record({
      telegramId: adminId, module: 'deposit', action: 'reject',
      target: dep.uid, amount: dep.amount, description: reason, result: 'success',
      metadata: { depositId: id },
    });
    return { ok: true };
  },
};

export { makeIdempotencyKey };
