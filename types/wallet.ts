// types/wallet.ts

export type WalletAction = 'ADD' | 'DEDUCT';

export type WalletBalanceType =
  | 'depositBalance'
  | 'winningBalance'
  | 'bonusBalance'
  | 'referralBalance';

export type WalletTxType =
  | 'ADD_MONEY'
  | 'ADMIN_DEDUCTION'
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'GAME_WIN'
  | 'GAME_LOSS'
  | 'BONUS'
  | 'REFERRAL'
  | 'REFUND'
  | 'ROLLBACK';

export interface WalletDoc {
  uid: string;
  depositBalance: number;
  winningBalance: number;
  bonusBalance: number;
  referralBalance: number;
  totalBalance: number;
  updatedAt: number;
  createdAt: number;
}

export interface WalletRequest {
  uid: string;
  action: WalletAction;
  type: WalletTxType;
  amount: number;
  balanceType: WalletBalanceType;
  description: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  performedBy?: string; // admin telegram id
}

export interface WalletTransaction {
  txId: string;
  uid: string;
  action: WalletAction;
  type: WalletTxType;
  amount: number;
  balanceType: WalletBalanceType;
  balanceBefore: number;
  balanceAfter: number;
  description: string;
  idempotencyKey: string;
  performedBy?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface WalletOperationResult {
  ok: true;
  txId: string;
  wallet: WalletDoc;
  transaction: WalletTransaction;
  duplicate?: boolean;
}

export interface WalletOperationFailure {
  ok: false;
  code:
    | 'INVALID_AMOUNT'
    | 'INVALID_USER'
    | 'WALLET_MISSING'
    | 'INSUFFICIENT_BALANCE'
    | 'DUPLICATE'
    | 'INTERNAL_ERROR';
  message: string;
}

export type WalletResult = WalletOperationResult | WalletOperationFailure;
