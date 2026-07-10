// lib/reports.ts
// Aggregated reports across users, revenue, deposits, withdrawals, wallets, games.

import { db } from './firebase';

const RANGES = {
  '24h': 24 * 60 * 60 * 1000,
  '7d':  7  * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
} as const;
export type ReportRange = keyof typeof RANGES;

export interface UsersReport {
  total: number;
  banned: number;
  active: number;
  newInRange: number;
}
export interface RevenueReport {
  totalDeposits: number;
  totalWithdrawals: number;
  net: number;
  count: { deposits: number; withdrawals: number };
}
export interface DepositReport  { pending: number; approvedInRange: number; totalInRange: number; }
export interface WithdrawReport { pending: number; approvedInRange: number; totalInRange: number; }
export interface WalletReport   { totalWallets: number; totalBalance: number; avgBalance: number; }
export interface GamesReport    { poker: { running: number; ended: number }; }

export const reportsService = {
  async users(range: ReportRange = '30d'): Promise<UsersReport> {
    const cutoff = Date.now() - RANGES[range];
    const totalSnap = await db().collection('users').count().get();
    const total = totalSnap.data().count;
    const bannedSnap = await db().collection('users').where('status', '==', 'banned').count().get();
    const banned = bannedSnap.data().count;
    const newSnap = await db().collection('users').where('createdAt', '>=', cutoff).count().get();
    const newInRange = newSnap.data().count;
    return { total, banned, active: Math.max(0, total - banned), newInRange };
  },

  async revenue(range: ReportRange = '30d'): Promise<RevenueReport> {
    const cutoff = Date.now() - RANGES[range];

    const depQ = await db()
      .collection('deposits')
      .where('status', '==', 'approved')
      .where('processedAt', '>=', cutoff)
      .get();
    let totalDeposits = 0;
    depQ.forEach(d => { totalDeposits += Number(d.data().amount || 0); });

    const wdQ = await db()
      .collection('withdrawals')
      .where('status', '==', 'approved')
      .where('processedAt', '>=', cutoff)
      .get();
    let totalWithdrawals = 0;
    wdQ.forEach(d => { totalWithdrawals += Number(d.data().amount || 0); });

    return {
      totalDeposits,
      totalWithdrawals,
      net: totalDeposits - totalWithdrawals,
      count: { deposits: depQ.size, withdrawals: wdQ.size },
    };
  },

  async deposits(range: ReportRange = '30d'): Promise<DepositReport> {
    const cutoff = Date.now() - RANGES[range];
    const pendingSnap = await db().collection('deposits').where('status', '==', 'pending').count().get();
    const approvedSnap = await db().collection('deposits')
      .where('status', '==', 'approved')
      .where('processedAt', '>=', cutoff)
      .count().get();
    const totalSnap = await db().collection('deposits').where('createdAt', '>=', cutoff).count().get();
    return {
      pending:         pendingSnap.data().count,
      approvedInRange: approvedSnap.data().count,
      totalInRange:    totalSnap.data().count,
    };
  },

  async withdrawals(range: ReportRange = '30d'): Promise<WithdrawReport> {
    const cutoff = Date.now() - RANGES[range];
    const pendingSnap = await db().collection('withdrawals').where('status', '==', 'pending').count().get();
    const approvedSnap = await db().collection('withdrawals')
      .where('status', '==', 'approved')
      .where('processedAt', '>=', cutoff)
      .count().get();
    const totalSnap = await db().collection('withdrawals').where('createdAt', '>=', cutoff).count().get();
    return {
      pending:         pendingSnap.data().count,
      approvedInRange: approvedSnap.data().count,
      totalInRange:    totalSnap.data().count,
    };
  },

  async wallets(): Promise<WalletReport> {
    // Sample-based: cap at 1000 wallets to keep this cheap.
    const q = await db().collection('wallets').limit(1000).get();
    let totalBalance = 0;
    q.forEach(d => { totalBalance += Number((d.data() as { totalBalance?: number }).totalBalance || 0); });
    return {
      totalWallets: q.size,
      totalBalance,
      avgBalance: q.size > 0 ? totalBalance / q.size : 0,
    };
  },

  async games(): Promise<GamesReport> {
    const runningSnap = await db().collection('poker_tables')
      .where('status', 'in', ['playing', 'waiting'])
      .count().get();
    const endedSnap = await db().collection('poker_tables')
      .where('status', 'in', ['ended', 'refunded'])
      .count().get();
    return {
      poker: {
        running: runningSnap.data().count,
        ended:   endedSnap.data().count,
      },
    };
  },
};
