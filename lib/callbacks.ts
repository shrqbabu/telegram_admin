// lib/callbacks.ts
// Central callback_data schema. Compact strings, colon-delimited.
// Telegram limits callback_data to 64 bytes, so keep encoding tight.

export const CB = {
  // Navigation
  home:      'nav:home',
  usersMenu: 'nav:users',
  wallet:    'nav:wallet',
  deposit:   'nav:deposit',
  withdraw:  'nav:withdraw',
  poker:     'nav:poker',
  reports:   'nav:reports',
  broadcast: 'nav:broadcast',
  ai:        'nav:ai',
  server:    'nav:server',
  logs:      'nav:logs',
  cancel:    'nav:cancel',

  // Users
  usersSearch:    'users:search',
  userView:       (uid: string) => `user:v:${uid}`,
  userWallet:     (uid: string) => `user:w:${uid}`,
  userProfile:    (uid: string) => `user:p:${uid}`,
  userBanAsk:     (uid: string) => `user:ba:${uid}`,
  userBanConfirm: (uid: string) => `user:bc:${uid}`,
  userUnbanAsk:   (uid: string) => `user:ua:${uid}`,
  userUnbanConfirm:(uid: string)=> `user:uc:${uid}`,
  userGames:      (uid: string) => `user:g:${uid}`,
  userTx:         (uid: string) => `user:t:${uid}`,

  // Wallet (from wallet menu)
  walletLookup:  'wallet:lookup',
  walletAdd:     (uid: string) => `wallet:add:${uid}`,
  walletDeduct:  (uid: string) => `wallet:ded:${uid}`,
  walletConfirm: 'wallet:confirm',

  // Deposit
  depositPending: 'dep:pending',
  depositHistory: 'dep:history',
  depositView:    (id: string) => `dep:v:${id}`,
  depositApprove: (id: string) => `dep:a:${id}`,
  depositApproveConfirm: (id: string) => `dep:ac:${id}`,
  depositRejectAsk:      (id: string) => `dep:ra:${id}`,

  // Withdraw
  withdrawPending: 'wd:pending',
  withdrawHistory: 'wd:history',
  withdrawView:    (id: string) => `wd:v:${id}`,
  withdrawApprove: (id: string) => `wd:a:${id}`,
  withdrawApproveConfirm: (id: string) => `wd:ac:${id}`,
  withdrawRejectAsk:      (id: string) => `wd:ra:${id}`,

  // Poker
  pokerList:       'pk:list',
  pokerView:       (id: string) => `pk:v:${id}`,
  pokerPlayers:    (id: string) => `pk:pl:${id}`,
  pokerKickAsk:    (id: string) => `pk:ka:${id}`,
  pokerRefundAsk:  (id: string) => `pk:ra:${id}`,
  pokerRefundConfirm: (id: string) => `pk:rc:${id}`,
  pokerEndAsk:     (id: string) => `pk:ea:${id}`,
  pokerEndConfirm: (id: string) => `pk:ec:${id}`,

  // Reports
  reportUsers:    'rep:users',
  reportRevenue:  'rep:revenue',
  reportDeposit:  'rep:deposit',
  reportWithdraw: 'rep:withdraw',
  reportWallet:   'rep:wallet',
  reportGames:    'rep:games',

  // Broadcast
  broadcastText:  'bc:text',
  broadcastImage: 'bc:image',
  broadcastVideo: 'bc:video',
  broadcastPdf:   'bc:pdf',
  broadcastConfirm: 'bc:confirm',

  // AI
  aiChat:  'ai:chat',
  aiCode:  'ai:code',
  aiLogs:  'ai:logs',
  aiDebug: 'ai:debug',

  // Logs / server
  logsRecent: 'logs:recent',
  logsMine:   'logs:mine',
  serverInfo: 'server:info',
} as const;

/** Parse "prefix:action:arg" callback data. */
export function parseCallback(data: string): { module: string; action: string; arg?: string } {
  const parts = data.split(':');
  return {
    module: parts[0] || '',
    action: parts[1] || '',
    arg:    parts.slice(2).join(':') || undefined,
  };
}
