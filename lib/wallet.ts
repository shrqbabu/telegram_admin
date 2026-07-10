// lib/wallet.ts
// Wallet service. Telegram Bot NEVER touches Firestore directly — always through here.
// Atomic transaction across wallet doc + transaction doc + idempotency doc.

import { db, FieldValue } from './firebase';
import { logger } from './logger';
import { validateWalletRequest } from './validators';
import type {
  WalletRequest, WalletResult, WalletDoc, WalletTransaction, WalletBalanceType,
} from '../types/wallet';

const WALLETS   = 'wallets';
const TX        = 'wallet_transactions';
const IDEM      = 'wallet_idempotency';

function emptyWallet(uid: string, now: number): WalletDoc {
  return {
    uid,
    depositBalance:   0,
    winningBalance:   0,
    bonusBalance:     0,
    referralBalance:  0,
    totalBalance:     0,
    updatedAt:        now,
    createdAt:        now,
  };
}

function recalcTotal(w: WalletDoc): number {
  return (
    (w.depositBalance  || 0) +
    (w.winningBalance  || 0) +
    (w.bonusBalance    || 0) +
    (w.referralBalance || 0)
  );
}

function pickBalance(w: WalletDoc, t: WalletBalanceType): number {
  return (w[t] as number) || 0;
}

export const walletService = {
  async getOrCreate(uid: string): Promise<WalletDoc> {
    const ref = db().collection(WALLETS).doc(uid);
    const snap = await ref.get();
    if (snap.exists) return snap.data() as WalletDoc;
    const now = Date.now();
    const w   = emptyWallet(uid, now);
    await ref.set(w);
    return w;
  },

  async getBalance(uid: string): Promise<WalletDoc | null> {
    const snap = await db().collection(WALLETS).doc(uid).get();
    return snap.exists ? (snap.data() as WalletDoc) : null;
  },

  async execute(rawReq: Partial<WalletRequest>): Promise<WalletResult> {
    let req: WalletRequest;
    try {
      req = validateWalletRequest(rawReq);
    } catch (err) {
      return { ok: false, code: 'INVALID_AMOUNT', message: (err as Error).message };
    }

    const walletRef = db().collection(WALLETS).doc(req.uid);
    const idemRef   = db().collection(IDEM).doc(req.idempotencyKey);
    const txRef     = db().collection(TX).doc(); // pre-allocate id

    try {
      const result = await db().runTransaction<WalletResult>(async trx => {
        // 1) Idempotency: if already executed, return the stored result.
        const idemSnap = await trx.get(idemRef);
        if (idemSnap.exists) {
          const stored = idemSnap.data() as { result: WalletOperationSuccess };
          logger.info('wallet.idempotent_hit', { key: req.idempotencyKey });
          return { ...stored.result, duplicate: true };
        }

        // 2) Load or create wallet.
        const walletSnap = await trx.get(walletRef);
        const now  = Date.now();
        let wallet: WalletDoc;
        if (!walletSnap.exists) {
          wallet = emptyWallet(req.uid, now);
        } else {
          wallet = walletSnap.data() as WalletDoc;
        }

        // 3) Compute new balance.
        const before = pickBalance(wallet, req.balanceType);
        let   after: number;
        if (req.action === 'ADD') {
          after = Number((before + req.amount).toFixed(2));
        } else {
          if (before < req.amount) {
            const fail: WalletResult = {
              ok: false, code: 'INSUFFICIENT_BALANCE',
              message: `Insufficient ${req.balanceType} (have ${before}, need ${req.amount})`,
            };
            // Persist idempotency for failure too, so retries don't succeed.
            trx.set(idemRef, { key: req.idempotencyKey, result: fail, createdAt: FieldValue.serverTimestamp() });
            return fail;
          }
          after = Number((before - req.amount).toFixed(2));
        }

        const updatedWallet: WalletDoc = {
          ...wallet,
          [req.balanceType]: after,
          updatedAt: now,
        } as WalletDoc;
        updatedWallet.totalBalance = recalcTotal(updatedWallet);

        // 4) Persist wallet + transaction + idempotency.
        trx.set(walletRef, updatedWallet, { merge: true });

        const txDoc: WalletTransaction = {
          txId: txRef.id,
          uid: req.uid,
          action: req.action,
          type: req.type,
          amount: req.amount,
          balanceType: req.balanceType,
          balanceBefore: before,
          balanceAfter: after,
          description: req.description,
          idempotencyKey: req.idempotencyKey,
          performedBy: req.performedBy,
          metadata: req.metadata,
          createdAt: now,
        };
        trx.set(txRef, txDoc);

        const ok: WalletOperationSuccess = { ok: true, txId: txRef.id, wallet: updatedWallet, transaction: txDoc };
        trx.set(idemRef, { key: req.idempotencyKey, result: ok, createdAt: FieldValue.serverTimestamp() });

        return ok;
      });

      return result;
    } catch (err) {
      logger.error('wallet.execute.error', { error: (err as Error).message, req });
      return { ok: false, code: 'INTERNAL_ERROR', message: (err as Error).message };
    }
  },

  async transactions(uid: string, limit = 20): Promise<WalletTransaction[]> {
    const q = await db()
      .collection(TX)
      .where('uid', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    return q.docs.map(d => d.data() as WalletTransaction);
  },
};

type WalletOperationSuccess = Extract<WalletResult, { ok: true }>;
