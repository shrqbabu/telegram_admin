// lib/router.ts
// Central router: receives normalized Telegram updates and dispatches to modules.

import { telegram, kb, backHomeRow } from './telegram';
import { CB, parseCallback } from './callbacks';
import { sessionStore } from './session';
import { walletService } from './wallet';
import { usersService } from './users';
import { depositService } from './deposit';
import { withdrawService } from './withdraw';
import { pokerService } from './poker';
import { reportsService } from './reports';
import { broadcastService, type BroadcastInput, type BroadcastMediaType } from './broadcast';
import { aiService } from './ai';
import { adminLogs } from './logs';
import { escapeHtml, makeIdempotencyKey, toMoney, truncate } from './utils';
import { logger } from './logger';
import type { TelegramUpdate, TelegramMessage, TelegramCallbackQuery, InlineKeyboardButton } from '../types/telegram';
import type { WalletAction } from '../types/wallet';

const HOME_TEXT = [
  '🏠 <b>Admin Panel</b>',
  '',
  'Select a module below:',
].join('\n');

function homeKeyboard() {
  return kb.build([
    [kb.button('👥 Users',     CB.usersMenu), kb.button('💰 Wallet',    CB.wallet)],
    [kb.button('💳 Deposit',   CB.deposit),   kb.button('🏦 Withdraw',  CB.withdraw)],
    [kb.button('🎮 Poker',     CB.poker),     kb.button('📊 Reports',   CB.reports)],
    [kb.button('📢 Broadcast', CB.broadcast), kb.button('🤖 AI',        CB.ai)],
    [kb.button('⚙ Server',     CB.server),    kb.button('📋 Logs',      CB.logs)],
  ]);
}

async function showHome(chatId: number, messageId?: number): Promise<void> {
  if (messageId) {
    await telegram.editMessageText({
      chat_id: chatId, message_id: messageId, text: HOME_TEXT, reply_markup: homeKeyboard(),
    }).catch(async () => {
      await telegram.sendMessage({ chat_id: chatId, text: HOME_TEXT, reply_markup: homeKeyboard() });
    });
  } else {
    await telegram.sendMessage({ chat_id: chatId, text: HOME_TEXT, reply_markup: homeKeyboard() });
  }
}

async function sendOrEdit(chatId: number, text: string, keyboard: ReturnType<typeof kb.build>, messageId?: number): Promise<void> {
  if (messageId) {
    try {
      await telegram.editMessageText({ chat_id: chatId, message_id: messageId, text, reply_markup: keyboard });
      return;
    } catch { /* fall through */ }
  }
  await telegram.sendMessage({ chat_id: chatId, text, reply_markup: keyboard });
}

// ─── Views ────────────────────────────────────────────────────────────────────
function walletMenuView() {
  return {
    text: '💰 <b>Wallet</b>\n\nEnter a user UID (or email / phone) to look up their wallet.',
    keyboard: kb.build([
      [kb.button('🔎 Lookup User', CB.walletLookup)],
      backHomeRow(CB.home),
    ]),
  };
}

function usersMenuView() {
  return {
    text: '👥 <b>Users</b>\n\nSearch by email, phone, or UID.',
    keyboard: kb.build([
      [kb.button('🔎 Search User', CB.usersSearch)],
      backHomeRow(CB.home),
    ]),
  };
}

function reportsMenuView() {
  return {
    text: '📊 <b>Reports</b>\n\nSelect a report:',
    keyboard: kb.build([
      [kb.button('👥 Users',    CB.reportUsers),    kb.button('💵 Revenue', CB.reportRevenue)],
      [kb.button('💳 Deposit',  CB.reportDeposit),  kb.button('🏦 Withdraw',CB.reportWithdraw)],
      [kb.button('💰 Wallets',  CB.reportWallet),   kb.button('🎮 Games',   CB.reportGames)],
      backHomeRow(CB.home),
    ]),
  };
}

function broadcastMenuView() {
  return {
    text: '📢 <b>Broadcast</b>\n\nChoose message type:',
    keyboard: kb.build([
      [kb.button('📝 Text',  CB.broadcastText), kb.button('🖼 Image', CB.broadcastImage)],
      [kb.button('🎞 Video', CB.broadcastVideo),kb.button('📄 PDF',   CB.broadcastPdf)],
      backHomeRow(CB.home),
    ]),
  };
}

function aiMenuView() {
  return {
    text: '🤖 <b>AI Assistant</b>\n\nChoose a mode:',
    keyboard: kb.build([
      [kb.button('💬 Chat',  CB.aiChat), kb.button('💻 Code', CB.aiCode)],
      [kb.button('📋 Logs',  CB.aiLogs), kb.button('🐛 Debug',CB.aiDebug)],
      backHomeRow(CB.home),
    ]),
  };
}

function serverInfoView() {
  const mem = process.memoryUsage();
  const text = [
    '⚙ <b>Server</b>',
    '',
    `Node: <code>${escapeHtml(process.version)}</code>`,
    `Platform: <code>${escapeHtml(process.platform)}</code>`,
    `Uptime: <code>${Math.floor(process.uptime())}s</code>`,
    `RSS: <code>${Math.round(mem.rss / 1024 / 1024)} MB</code>`,
    `Heap: <code>${Math.round(mem.heapUsed / 1024 / 1024)} MB</code>`,
  ].join('\n');
  return { text, keyboard: kb.build([backHomeRow(CB.home)]) };
}

// ─── Message renderers ───────────────────────────────────────────────────────
function renderUserCard(u: NonNullable<Awaited<ReturnType<typeof usersService.findByUid>>>) {
  const lines = [
    '👤 <b>User</b>',
    '',
    `<b>UID:</b> <code>${escapeHtml(u.uid)}</code>`,
    `<b>Name:</b> ${escapeHtml(u.displayName || '—')}`,
    `<b>Email:</b> ${escapeHtml(u.email || '—')}`,
    `<b>Phone:</b> ${escapeHtml(u.phone || '—')}`,
    `<b>Status:</b> ${escapeHtml(u.status)}`,
    `<b>Last Login:</b> ${u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : '—'}`,
  ];
  if (u.banReason) lines.push(`<b>Ban Reason:</b> ${escapeHtml(u.banReason)}`);
  return lines.join('\n');
}

function renderWalletCard(uid: string, w: Awaited<ReturnType<typeof walletService.getBalance>>) {
  if (!w) return `💰 <b>Wallet</b>\n\nNo wallet found for <code>${escapeHtml(uid)}</code>.`;
  return [
    '💰 <b>Wallet</b>',
    '',
    `<b>UID:</b> <code>${escapeHtml(uid)}</code>`,
    `<b>Deposit:</b>  ₹${toMoney(w.depositBalance)}`,
    `<b>Winnings:</b> ₹${toMoney(w.winningBalance)}`,
    `<b>Bonus:</b>    ₹${toMoney(w.bonusBalance)}`,
    `<b>Referral:</b> ₹${toMoney(w.referralBalance)}`,
    `<b>Total:</b>    ₹${toMoney(w.totalBalance)}`,
  ].join('\n');
}

// ─── Router entrypoint ───────────────────────────────────────────────────────
export async function handleUpdate(update: TelegramUpdate, telegramId: number): Promise<void> {
  try {
    if (update.callback_query) {
      await handleCallback(update.callback_query, telegramId);
      return;
    }
    if (update.message) {
      await handleMessage(update.message, telegramId);
      return;
    }
  } catch (err) {
    logger.error('router.handle.error', { error: (err as Error).message, telegramId });
  }
}

// ─── Text message handler ────────────────────────────────────────────────────
async function handleMessage(msg: TelegramMessage, telegramId: number): Promise<void> {
  const chatId = msg.chat.id;
  const text   = (msg.text || msg.caption || '').trim();

  // Slash commands
  if (text === '/start' || text === '/home' || text === '/menu') {
    await sessionStore.clear(telegramId);
    await showHome(chatId);
    return;
  }
  if (text === '/cancel') {
    await sessionStore.clear(telegramId);
    await telegram.sendMessage({ chat_id: chatId, text: '✅ Cancelled.' });
    await showHome(chatId);
    return;
  }

  // Stateful conversation
  const session = await sessionStore.get(telegramId);
  if (!session || session.state === 'idle') {
    // No active flow — send home.
    await showHome(chatId);
    return;
  }

  switch (session.state) {
    case 'users:await_query':      return handleUsersQuery(chatId, telegramId, text);
    case 'wallet:await_uid':       return handleWalletUid(chatId, telegramId, text);
    case 'wallet:await_amount':    return handleWalletAmount(chatId, telegramId, text, session.context);
    case 'wallet:await_description': return handleWalletDescription(chatId, telegramId, text, session.context);
    case 'withdraw:await_reject_reason': return handleWithdrawRejectReason(chatId, telegramId, text, session.context);
    case 'deposit:await_reject_reason':  return handleDepositRejectReason(chatId, telegramId, text, session.context);
    case 'broadcast:await_content':      return handleBroadcastContent(chatId, telegramId, msg, session.context);
    case 'poker:await_kick_uid':         return handlePokerKickUid(chatId, telegramId, text, session.context);
    case 'ai:await_prompt':              return handleAiPrompt(chatId, telegramId, text, session.context);
    default:
      await sessionStore.clear(telegramId);
      await showHome(chatId);
  }
}

// ─── Callback handler ────────────────────────────────────────────────────────
async function handleCallback(cb: TelegramCallbackQuery, telegramId: number): Promise<void> {
  const data    = cb.data || '';
  const chatId  = cb.message?.chat.id;
  const msgId   = cb.message?.message_id;
  if (!chatId) {
    await telegram.answerCallbackQuery({ callback_query_id: cb.id, text: 'Session expired', show_alert: true });
    return;
  }

  await telegram.answerCallbackQuery({ callback_query_id: cb.id }).catch(() => {});

  const p = parseCallback(data);

  // ─── Navigation ────────────────────────────────────────
  if (data === CB.home)      { await sessionStore.clear(telegramId); return showHome(chatId, msgId); }
  if (data === CB.cancel)    { await sessionStore.clear(telegramId); return showHome(chatId, msgId); }
  if (data === CB.usersMenu) { const v = usersMenuView();     return sendOrEdit(chatId, v.text, v.keyboard, msgId); }
  if (data === CB.wallet)    { const v = walletMenuView();    return sendOrEdit(chatId, v.text, v.keyboard, msgId); }
  if (data === CB.reports)   { const v = reportsMenuView();   return sendOrEdit(chatId, v.text, v.keyboard, msgId); }
  if (data === CB.broadcast) { const v = broadcastMenuView(); return sendOrEdit(chatId, v.text, v.keyboard, msgId); }
  if (data === CB.ai)        { const v = aiMenuView();        return sendOrEdit(chatId, v.text, v.keyboard, msgId); }
  if (data === CB.server)    { const v = serverInfoView();    return sendOrEdit(chatId, v.text, v.keyboard, msgId); }

  // ─── Users ────────────────────────────────────────────
  if (data === CB.usersSearch) {
    await sessionStore.set(telegramId, chatId, 'users:await_query');
    await telegram.sendMessage({
      chat_id: chatId,
      text: '🔎 Send the user email, phone (E.164) or UID.\n\nType /cancel to abort.',
    });
    return;
  }

  if (p.module === 'user' && p.arg) {
    return handleUserAction(chatId, telegramId, p.action, p.arg, msgId);
  }

  // ─── Wallet ───────────────────────────────────────────
  if (data === CB.walletLookup) {
    await sessionStore.set(telegramId, chatId, 'wallet:await_uid');
    await telegram.sendMessage({
      chat_id: chatId,
      text: '💰 Send the user UID (or email/phone) to look up their wallet.\n\nType /cancel to abort.',
    });
    return;
  }
  if (p.module === 'wallet' && (p.action === 'add' || p.action === 'ded') && p.arg) {
    const uid = p.arg;
    const action: WalletAction = p.action === 'add' ? 'ADD' : 'DEDUCT';
    await sessionStore.set(telegramId, chatId, 'wallet:await_amount', { uid, action, balanceType: 'depositBalance' });
    await telegram.sendMessage({
      chat_id: chatId,
      text: `💰 <b>${action}</b> to depositBalance for <code>${escapeHtml(uid)}</code>\n\nSend the <b>amount</b> (positive number).\n\nType /cancel to abort.`,
      parse_mode: 'HTML',
    });
    return;
  }
  if (data === CB.walletConfirm) {
    return executeWalletConfirmed(chatId, telegramId, msgId);
  }

  // ─── Deposit ──────────────────────────────────────────
  if (data === CB.deposit) {
    return renderDepositList(chatId, msgId, 'pending');
  }
  if (data === CB.depositPending) return renderDepositList(chatId, msgId, 'pending');
  if (data === CB.depositHistory) return renderDepositList(chatId, msgId, 'history');
  if (p.module === 'dep' && p.arg) {
    return handleDepositAction(chatId, telegramId, p.action, p.arg, msgId);
  }

  // ─── Withdraw ─────────────────────────────────────────
  if (data === CB.withdraw) {
    return renderWithdrawList(chatId, msgId, 'pending');
  }
  if (data === CB.withdrawPending) return renderWithdrawList(chatId, msgId, 'pending');
  if (data === CB.withdrawHistory) return renderWithdrawList(chatId, msgId, 'history');
  if (p.module === 'wd' && p.arg) {
    return handleWithdrawAction(chatId, telegramId, p.action, p.arg, msgId);
  }

  // ─── Poker ────────────────────────────────────────────
  if (data === CB.poker || data === CB.pokerList) {
    return renderPokerList(chatId, msgId);
  }
  if (p.module === 'pk' && p.arg) {
    return handlePokerAction(chatId, telegramId, p.action, p.arg, msgId);
  }

  // ─── Reports ──────────────────────────────────────────
  if (p.module === 'rep') {
    return handleReport(chatId, msgId, p.action);
  }

  // ─── Broadcast ────────────────────────────────────────
  if (p.module === 'bc') {
    return handleBroadcastMenu(chatId, telegramId, p.action, msgId);
  }

  // ─── AI ────────────────────────────────────────────────
  if (p.module === 'ai') {
    return handleAiMenu(chatId, telegramId, p.action, msgId);
  }

  // ─── Logs ──────────────────────────────────────────────
  if (data === CB.logs || data === CB.logsRecent) return renderLogs(chatId, msgId, 'recent');
  if (data === CB.logsMine) return renderLogs(chatId, msgId, 'mine', telegramId);

  // Fallback: home
  await showHome(chatId, msgId);
}

// ─── User actions ────────────────────────────────────────────────────────────
async function handleUsersQuery(chatId: number, telegramId: number, query: string): Promise<void> {
  const user = await usersService.search(query);
  if (!user) {
    await sessionStore.clear(telegramId);
    await telegram.sendMessage({
      chat_id: chatId,
      text: '❌ User not found.',
      reply_markup: kb.build([backHomeRow(CB.usersMenu)]),
    });
    return;
  }
  await sessionStore.clear(telegramId);
  await telegram.sendMessage({
    chat_id: chatId,
    text: renderUserCard(user),
    reply_markup: buildUserKeyboard(user.uid, user.status === 'banned'),
  });
}

function buildUserKeyboard(uid: string, isBanned: boolean) {
  const banRow: InlineKeyboardButton[] = isBanned
    ? [kb.button('✅ Unban', CB.userUnbanAsk(uid))]
    : [kb.button('🚫 Ban',   CB.userBanAsk(uid))];
  return kb.build([
    [kb.button('💰 Wallet', CB.userWallet(uid)), kb.button('📄 Profile', CB.userProfile(uid))],
    banRow,
    [kb.button('🎮 Games', CB.userGames(uid)), kb.button('📜 Tx', CB.userTx(uid))],
    backHomeRow(CB.usersMenu),
  ]);
}

async function handleUserAction(chatId: number, telegramId: number, action: string, uid: string, msgId?: number): Promise<void> {
  const user = await usersService.findByUid(uid);
  if (!user) {
    await sendOrEdit(chatId, '❌ User not found.', kb.build([backHomeRow(CB.usersMenu)]), msgId);
    return;
  }

  switch (action) {
    case 'v': // view
    case 'p': // profile
      return sendOrEdit(chatId, renderUserCard(user), buildUserKeyboard(uid, user.status === 'banned'), msgId);

    case 'w': { // wallet
      const w = await walletService.getBalance(uid);
      const text = renderWalletCard(uid, w);
      const keyboard = kb.build([
        [kb.button('➕ Add', CB.walletAdd(uid)), kb.button('➖ Deduct', CB.walletDeduct(uid))],
        [kb.button('📜 Tx', CB.userTx(uid))],
        backHomeRow(CB.userView(uid)),
      ]);
      return sendOrEdit(chatId, text, keyboard, msgId);
    }

    case 'ba': { // ban ask
      const text = `⚠️ Confirm <b>BAN</b> for <code>${escapeHtml(uid)}</code>?`;
      const keyboard = kb.build([
        [kb.button('✅ Confirm Ban', CB.userBanConfirm(uid)), kb.button('❌ Cancel', CB.userView(uid))],
      ]);
      return sendOrEdit(chatId, text, keyboard, msgId);
    }

    case 'bc': { // ban confirm
      await usersService.ban(uid, 'Banned via admin panel', telegramId);
      await adminLogs.record({
        telegramId, module: 'users', action: 'ban', target: uid, result: 'success',
      });
      const fresh = await usersService.findByUid(uid);
      return sendOrEdit(chatId, `🚫 User banned.\n\n${renderUserCard(fresh!)}`, buildUserKeyboard(uid, true), msgId);
    }

    case 'ua': {
      const text = `⚠️ Confirm <b>UNBAN</b> for <code>${escapeHtml(uid)}</code>?`;
      const keyboard = kb.build([
        [kb.button('✅ Confirm Unban', CB.userUnbanConfirm(uid)), kb.button('❌ Cancel', CB.userView(uid))],
      ]);
      return sendOrEdit(chatId, text, keyboard, msgId);
    }

    case 'uc': {
      await usersService.unban(uid, telegramId);
      await adminLogs.record({
        telegramId, module: 'users', action: 'unban', target: uid, result: 'success',
      });
      const fresh = await usersService.findByUid(uid);
      return sendOrEdit(chatId, `✅ User unbanned.\n\n${renderUserCard(fresh!)}`, buildUserKeyboard(uid, false), msgId);
    }

    case 'g': {
      const games = await usersService.recentGames(uid, 10);
      const lines = games.length
        ? games.map(g => `• ${escapeHtml(g.game)} — ${escapeHtml(g.result)} — ₹${toMoney(g.amount)}`).join('\n')
        : '<i>No recent games.</i>';
      return sendOrEdit(chatId, `🎮 <b>Recent Games</b>\n\n${lines}`,
        kb.build([backHomeRow(CB.userView(uid))]), msgId);
    }

    case 't': {
      const txs = await usersService.recentTransactions(uid, 10);
      const lines = txs.length
        ? txs.map(t => `• ${t.action} ₹${toMoney(t.amount)} ${escapeHtml(t.balanceType)} — ${escapeHtml(t.type)} — ${escapeHtml(truncate(t.description, 40))}`).join('\n')
        : '<i>No transactions.</i>';
      return sendOrEdit(chatId, `📜 <b>Recent Transactions</b>\n\n${lines}`,
        kb.build([backHomeRow(CB.userView(uid))]), msgId);
    }

    default:
      return sendOrEdit(chatId, renderUserCard(user), buildUserKeyboard(uid, user.status === 'banned'), msgId);
  }
}

// ─── Wallet flow ─────────────────────────────────────────────────────────────
async function handleWalletUid(chatId: number, telegramId: number, query: string): Promise<void> {
  const user = await usersService.search(query);
  if (!user) {
    await sessionStore.clear(telegramId);
    await telegram.sendMessage({ chat_id: chatId, text: '❌ User not found.',
      reply_markup: kb.build([backHomeRow(CB.wallet)]) });
    return;
  }
  const w = await walletService.getOrCreate(user.uid);
  await sessionStore.clear(telegramId);
  await telegram.sendMessage({
    chat_id: chatId,
    text: renderWalletCard(user.uid, w),
    reply_markup: kb.build([
      [kb.button('➕ Add', CB.walletAdd(user.uid)), kb.button('➖ Deduct', CB.walletDeduct(user.uid))],
      [kb.button('📜 Tx', CB.userTx(user.uid))],
      backHomeRow(CB.wallet),
    ]),
  });
}

async function handleWalletAmount(chatId: number, telegramId: number, text: string, ctx: Record<string, unknown>): Promise<void> {
  const amount = Number(text.replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) {
    await telegram.sendMessage({ chat_id: chatId, text: '❌ Invalid amount. Send a positive number.' });
    return;
  }
  await sessionStore.set(telegramId, chatId, 'wallet:await_description', { ...ctx, amount });
  await telegram.sendMessage({
    chat_id: chatId,
    text: `✏️ Send a <b>description</b> for this transaction.\n\nType /cancel to abort.`,
    parse_mode: 'HTML',
  });
}

async function handleWalletDescription(chatId: number, telegramId: number, text: string, ctx: Record<string, unknown>): Promise<void> {
  const description = text.trim().slice(0, 200);
  const uid    = String(ctx.uid || '');
  const action = String(ctx.action || 'ADD') as WalletAction;
  const amount = Number(ctx.amount || 0);
  const balanceType = String(ctx.balanceType || 'depositBalance') as
    'depositBalance' | 'winningBalance' | 'bonusBalance' | 'referralBalance';

  const preview = [
    '⚠️ <b>Confirm Wallet Operation</b>',
    '',
    `<b>UID:</b> <code>${escapeHtml(uid)}</code>`,
    `<b>Action:</b> ${action}`,
    `<b>Amount:</b> ₹${toMoney(amount)}`,
    `<b>Balance:</b> ${escapeHtml(balanceType)}`,
    `<b>Note:</b> ${escapeHtml(description)}`,
  ].join('\n');

  const idempotencyKey = makeIdempotencyKey(telegramId);
  await sessionStore.set(telegramId, chatId, 'wallet:await_confirm', {
    uid, action, amount, balanceType, description, idempotencyKey,
  });

  await telegram.sendMessage({
    chat_id: chatId, text: preview,
    reply_markup: kb.build([
      [kb.button('✅ Confirm', CB.walletConfirm), kb.button('❌ Cancel', CB.cancel)],
    ]),
  });
}

async function executeWalletConfirmed(chatId: number, telegramId: number, msgId?: number): Promise<void> {
  const s = await sessionStore.get(telegramId);
  if (!s || s.state !== 'wallet:await_confirm') {
    await sendOrEdit(chatId, '❌ Session expired.', kb.build([backHomeRow(CB.home)]), msgId);
    return;
  }
  const c = s.context;
  const result = await walletService.execute({
    uid:            String(c.uid),
    action:         String(c.action) as WalletAction,
    type:           c.action === 'ADD' ? 'ADD_MONEY' : 'ADMIN_DEDUCTION',
    amount:         Number(c.amount),
    balanceType:    String(c.balanceType) as 'depositBalance',
    description:    String(c.description || ''),
    idempotencyKey: String(c.idempotencyKey),
    performedBy:    String(telegramId),
  });

  await sessionStore.clear(telegramId);

  if (!result.ok) {
    await adminLogs.record({
      telegramId, module: 'wallet', action: String(c.action).toLowerCase(),
      target: String(c.uid), amount: Number(c.amount),
      result: 'failure', errorMessage: result.message,
    });
    await sendOrEdit(chatId, `❌ Wallet failed: ${escapeHtml(result.message)}`,
      kb.build([backHomeRow(CB.wallet)]), msgId);
    return;
  }

  await adminLogs.record({
    telegramId, module: 'wallet', action: String(c.action).toLowerCase(),
    target: String(c.uid), amount: Number(c.amount), description: String(c.description),
    result: 'success', metadata: { txId: result.txId, duplicate: result.duplicate },
  });

  const text = [
    result.duplicate ? '♻️ <b>Duplicate — already executed.</b>' : '✅ <b>Wallet updated.</b>',
    '',
    renderWalletCard(String(c.uid), result.wallet),
    '',
    `<b>Tx:</b> <code>${escapeHtml(result.txId)}</code>`,
  ].join('\n');

  await sendOrEdit(chatId, text, kb.build([backHomeRow(CB.wallet)]), msgId);
}

// ─── Deposit flow ────────────────────────────────────────────────────────────
async function renderDepositList(chatId: number, msgId: number | undefined, mode: 'pending' | 'history'): Promise<void> {
  const list = mode === 'pending'
    ? await depositService.pending(10)
    : await depositService.history(10);
  if (list.length === 0) {
    await sendOrEdit(chatId, `💳 <b>Deposits — ${mode}</b>\n\n<i>None.</i>`,
      kb.build([[kb.button('🕓 Pending', CB.depositPending), kb.button('📜 History', CB.depositHistory)], backHomeRow(CB.home)]), msgId);
    return;
  }
  const rows = list.map(d => [kb.button(
    `${d.status === 'pending' ? '🕓' : d.status === 'approved' ? '✅' : '❌'} ₹${toMoney(d.amount)} — ${truncate(d.uid, 10)}`,
    CB.depositView(d.id),
  )]);
  rows.push([kb.button('🕓 Pending', CB.depositPending), kb.button('📜 History', CB.depositHistory)]);
  rows.push(backHomeRow(CB.home));
  await sendOrEdit(chatId, `💳 <b>Deposits — ${mode}</b>`, kb.build(rows), msgId);
}

async function handleDepositAction(chatId: number, telegramId: number, action: string, id: string, msgId?: number): Promise<void> {
  const dep = await depositService.get(id);
  if (!dep) {
    await sendOrEdit(chatId, '❌ Deposit not found.', kb.build([backHomeRow(CB.deposit)]), msgId);
    return;
  }

  if (action === 'v') {
    const text = [
      '💳 <b>Deposit</b>',
      '',
      `<b>ID:</b> <code>${escapeHtml(dep.id)}</code>`,
      `<b>UID:</b> <code>${escapeHtml(dep.uid)}</code>`,
      `<b>Amount:</b> ₹${toMoney(dep.amount)}`,
      `<b>Method:</b> ${escapeHtml(dep.method)}`,
      `<b>Status:</b> ${escapeHtml(dep.status)}`,
      dep.reference ? `<b>Ref:</b> ${escapeHtml(dep.reference)}` : '',
      dep.screenshotUrl ? `<b>Screenshot:</b> ${escapeHtml(dep.screenshotUrl)}` : '',
      dep.rejectReason ? `<b>Reject Reason:</b> ${escapeHtml(dep.rejectReason)}` : '',
    ].filter(Boolean).join('\n');
    const rows: InlineKeyboardButton[][] = [];
    if (dep.status === 'pending') {
      rows.push([kb.button('✅ Approve', CB.depositApprove(dep.id)), kb.button('❌ Reject', CB.depositRejectAsk(dep.id))]);
    }
    rows.push(backHomeRow(CB.deposit));
    return sendOrEdit(chatId, text, kb.build(rows), msgId);
  }

  if (action === 'a') { // approve → confirm
    const text = `⚠️ Confirm <b>APPROVE</b> deposit <code>${escapeHtml(dep.id)}</code> for ₹${toMoney(dep.amount)}?`;
    return sendOrEdit(chatId, text, kb.build([
      [kb.button('✅ Confirm', CB.depositApproveConfirm(dep.id)), kb.button('❌ Cancel', CB.depositView(dep.id))],
    ]), msgId);
  }

  if (action === 'ac') {
    const r = await depositService.approve(dep.id, telegramId);
    const text = r.ok ? `✅ Deposit approved.` : `❌ ${escapeHtml(r.error)}`;
    return sendOrEdit(chatId, text, kb.build([backHomeRow(CB.deposit)]), msgId);
  }

  if (action === 'ra') {
    await sessionStore.set(telegramId, chatId, 'deposit:await_reject_reason', { depositId: dep.id });
    await telegram.sendMessage({
      chat_id: chatId,
      text: `❌ Send a rejection reason for deposit <code>${escapeHtml(dep.id)}</code>.\n\nType /cancel to abort.`,
      parse_mode: 'HTML',
    });
    return;
  }
}

async function handleDepositRejectReason(chatId: number, telegramId: number, text: string, ctx: Record<string, unknown>): Promise<void> {
  const id = String(ctx.depositId || '');
  await sessionStore.clear(telegramId);
  const r = await depositService.reject(id, telegramId, text.trim().slice(0, 500));
  await telegram.sendMessage({
    chat_id: chatId,
    text: r.ok ? '❌ Deposit rejected.' : `⚠️ ${r.error}`,
    reply_markup: kb.build([backHomeRow(CB.deposit)]),
  });
}

// ─── Withdraw flow ───────────────────────────────────────────────────────────
async function renderWithdrawList(chatId: number, msgId: number | undefined, mode: 'pending' | 'history'): Promise<void> {
  const list = mode === 'pending' ? await withdrawService.pending(10) : await withdrawService.history(10);
  if (list.length === 0) {
    await sendOrEdit(chatId, `🏦 <b>Withdrawals — ${mode}</b>\n\n<i>None.</i>`,
      kb.build([[kb.button('🕓 Pending', CB.withdrawPending), kb.button('📜 History', CB.withdrawHistory)], backHomeRow(CB.home)]), msgId);
    return;
  }
  const rows = list.map(w => [kb.button(
    `${w.status === 'pending' ? '🕓' : w.status === 'approved' ? '✅' : '❌'} ₹${toMoney(w.amount)} — ${truncate(w.uid, 10)}`,
    CB.withdrawView(w.id),
  )]);
  rows.push([kb.button('🕓 Pending', CB.withdrawPending), kb.button('📜 History', CB.withdrawHistory)]);
  rows.push(backHomeRow(CB.home));
  await sendOrEdit(chatId, `🏦 <b>Withdrawals — ${mode}</b>`, kb.build(rows), msgId);
}

async function handleWithdrawAction(chatId: number, telegramId: number, action: string, id: string, msgId?: number): Promise<void> {
  const w = await withdrawService.get(id);
  if (!w) {
    await sendOrEdit(chatId, '❌ Withdrawal not found.', kb.build([backHomeRow(CB.withdraw)]), msgId);
    return;
  }

  if (action === 'v') {
    const text = [
      '🏦 <b>Withdrawal</b>',
      '',
      `<b>ID:</b> <code>${escapeHtml(w.id)}</code>`,
      `<b>UID:</b> <code>${escapeHtml(w.uid)}</code>`,
      `<b>Amount:</b> ₹${toMoney(w.amount)}`,
      `<b>Method:</b> ${escapeHtml(w.method)}`,
      `<b>Destination:</b> ${escapeHtml(w.destination || '—')}`,
      `<b>Status:</b> ${escapeHtml(w.status)}`,
      w.rejectReason ? `<b>Reject Reason:</b> ${escapeHtml(w.rejectReason)}` : '',
    ].filter(Boolean).join('\n');
    const rows: InlineKeyboardButton[][] = [];
    if (w.status === 'pending') {
      rows.push([kb.button('✅ Approve', CB.withdrawApprove(w.id)), kb.button('❌ Reject', CB.withdrawRejectAsk(w.id))]);
    }
    rows.push(backHomeRow(CB.withdraw));
    return sendOrEdit(chatId, text, kb.build(rows), msgId);
  }

  if (action === 'a') {
    const text = `⚠️ Confirm <b>APPROVE</b> withdrawal <code>${escapeHtml(w.id)}</code> for ₹${toMoney(w.amount)}?`;
    return sendOrEdit(chatId, text, kb.build([
      [kb.button('✅ Confirm', CB.withdrawApproveConfirm(w.id)), kb.button('❌ Cancel', CB.withdrawView(w.id))],
    ]), msgId);
  }

  if (action === 'ac') {
    const r = await withdrawService.approve(w.id, telegramId);
    const text = r.ok ? `✅ Withdrawal approved.` : `❌ ${escapeHtml(r.error)}`;
    return sendOrEdit(chatId, text, kb.build([backHomeRow(CB.withdraw)]), msgId);
  }

  if (action === 'ra') {
    await sessionStore.set(telegramId, chatId, 'withdraw:await_reject_reason', { withdrawalId: w.id });
    await telegram.sendMessage({
      chat_id: chatId,
      text: `❌ Send a rejection reason for withdrawal <code>${escapeHtml(w.id)}</code>.\n\nType /cancel to abort.`,
      parse_mode: 'HTML',
    });
    return;
  }
}

async function handleWithdrawRejectReason(chatId: number, telegramId: number, text: string, ctx: Record<string, unknown>): Promise<void> {
  const id = String(ctx.withdrawalId || '');
  await sessionStore.clear(telegramId);
  const r = await withdrawService.reject(id, telegramId, text.trim().slice(0, 500));
  await telegram.sendMessage({
    chat_id: chatId,
    text: r.ok ? '❌ Withdrawal rejected.' : `⚠️ ${r.error}`,
    reply_markup: kb.build([backHomeRow(CB.withdraw)]),
  });
}

// ─── Poker flow ──────────────────────────────────────────────────────────────
async function renderPokerList(chatId: number, msgId?: number): Promise<void> {
  const tables = await pokerService.runningTables(20);
  if (tables.length === 0) {
    await sendOrEdit(chatId, '🎮 <b>Poker</b>\n\n<i>No running tables.</i>',
      kb.build([backHomeRow(CB.home)]), msgId);
    return;
  }
  const rows = tables.map(t => [kb.button(
    `${t.status === 'playing' ? '🟢' : '🟡'} ${truncate(t.name || t.id, 12)} — ${t.players.length}p — Pot ₹${toMoney(t.pot || 0)}`,
    CB.pokerView(t.id),
  )]);
  rows.push(backHomeRow(CB.home));
  await sendOrEdit(chatId, '🎮 <b>Poker — Running Tables</b>', kb.build(rows), msgId);
}

async function handlePokerAction(chatId: number, telegramId: number, action: string, id: string, msgId?: number): Promise<void> {
  const t = await pokerService.get(id);
  if (!t) {
    await sendOrEdit(chatId, '❌ Table not found.', kb.build([backHomeRow(CB.poker)]), msgId);
    return;
  }

  if (action === 'v') {
    const text = [
      `🎮 <b>Table ${escapeHtml(t.name || t.id)}</b>`,
      '',
      `<b>Status:</b> ${escapeHtml(t.status)}`,
      `<b>Phase:</b> ${escapeHtml(t.phase || '—')}`,
      `<b>Pot:</b> ₹${toMoney(t.pot || 0)}`,
      `<b>Blinds:</b> ${t.smallBlind}/${t.bigBlind}`,
      `<b>Players:</b> ${t.players.length}`,
    ].join('\n');
    const rows: InlineKeyboardButton[][] = [
      [kb.button('👥 Players', CB.pokerPlayers(t.id))],
      [kb.button('👢 Kick', CB.pokerKickAsk(t.id)), kb.button('💸 Refund', CB.pokerRefundAsk(t.id))],
      [kb.button('🛑 End Table', CB.pokerEndAsk(t.id))],
      backHomeRow(CB.poker),
    ];
    return sendOrEdit(chatId, text, kb.build(rows), msgId);
  }

  if (action === 'pl') {
    const lines = t.players.length
      ? t.players.map(p => `• ${escapeHtml(p.name)} (${escapeHtml(p.uid.slice(0, 10))}…) — ₹${toMoney(p.chips)}`).join('\n')
      : '<i>No players.</i>';
    return sendOrEdit(chatId, `👥 <b>Players — ${escapeHtml(t.name || t.id)}</b>\n\n${lines}`,
      kb.build([backHomeRow(CB.pokerView(t.id))]), msgId);
  }

  if (action === 'ka') {
    await sessionStore.set(telegramId, chatId, 'poker:await_kick_uid', { tableId: t.id });
    await telegram.sendMessage({
      chat_id: chatId,
      text: `👢 Send the UID to kick from table <code>${escapeHtml(t.id)}</code>.\n\nType /cancel to abort.`,
      parse_mode: 'HTML',
    });
    return;
  }

  if (action === 'ra') {
    return sendOrEdit(chatId,
      `⚠️ Confirm <b>FULL REFUND</b> of table <code>${escapeHtml(t.id)}</code>?\nAll players' chips will be refunded and the table cleared.`,
      kb.build([
        [kb.button('✅ Confirm Refund', CB.pokerRefundConfirm(t.id)), kb.button('❌ Cancel', CB.pokerView(t.id))],
      ]), msgId);
  }

  if (action === 'rc') {
    const r = await pokerService.refundTable(t.id, telegramId);
    const text = r.ok ? `💸 Refunded ₹${toMoney(r.refunded)} across ${t.players.length} players.` : `❌ ${escapeHtml(r.error)}`;
    return sendOrEdit(chatId, text, kb.build([backHomeRow(CB.poker)]), msgId);
  }

  if (action === 'ea') {
    return sendOrEdit(chatId,
      `⚠️ Confirm <b>END</b> table <code>${escapeHtml(t.id)}</code>?`,
      kb.build([
        [kb.button('✅ Confirm End', CB.pokerEndConfirm(t.id)), kb.button('❌ Cancel', CB.pokerView(t.id))],
      ]), msgId);
  }

  if (action === 'ec') {
    const r = await pokerService.endTable(t.id, telegramId);
    return sendOrEdit(chatId, r.ok ? '🛑 Table ended.' : `❌ ${escapeHtml(r.error)}`,
      kb.build([backHomeRow(CB.poker)]), msgId);
  }
}

async function handlePokerKickUid(chatId: number, telegramId: number, uid: string, ctx: Record<string, unknown>): Promise<void> {
  const tableId = String(ctx.tableId || '');
  await sessionStore.clear(telegramId);
  const r = await pokerService.kickPlayer(tableId, uid.trim(), telegramId);
  await telegram.sendMessage({
    chat_id: chatId,
    text: r.ok ? '👢 Player kicked and refunded.' : `❌ ${r.error}`,
    reply_markup: kb.build([backHomeRow(CB.pokerView(tableId))]),
  });
}

// ─── Reports ─────────────────────────────────────────────────────────────────
async function handleReport(chatId: number, msgId: number | undefined, action: string): Promise<void> {
  let text = '';
  switch (action) {
    case 'users': {
      const r = await reportsService.users('30d');
      text = ['👥 <b>Users — 30d</b>', '',
        `Total:  ${r.total}`, `Active: ${r.active}`, `Banned: ${r.banned}`, `New:    ${r.newInRange}`].join('\n');
      break;
    }
    case 'revenue': {
      const r = await reportsService.revenue('30d');
      text = ['💵 <b>Revenue — 30d</b>', '',
        `Deposits:    ₹${toMoney(r.totalDeposits)} (${r.count.deposits})`,
        `Withdrawals: ₹${toMoney(r.totalWithdrawals)} (${r.count.withdrawals})`,
        `Net:         ₹${toMoney(r.net)}`].join('\n');
      break;
    }
    case 'deposit': {
      const r = await reportsService.deposits('30d');
      text = ['💳 <b>Deposits — 30d</b>', '',
        `Pending:  ${r.pending}`, `Approved: ${r.approvedInRange}`, `Total:    ${r.totalInRange}`].join('\n');
      break;
    }
    case 'withdraw': {
      const r = await reportsService.withdrawals('30d');
      text = ['🏦 <b>Withdrawals — 30d</b>', '',
        `Pending:  ${r.pending}`, `Approved: ${r.approvedInRange}`, `Total:    ${r.totalInRange}`].join('\n');
      break;
    }
    case 'wallet': {
      const r = await reportsService.wallets();
      text = ['💰 <b>Wallets (sample ≤1000)</b>', '',
        `Wallets: ${r.totalWallets}`,
        `Total balance: ₹${toMoney(r.totalBalance)}`,
        `Avg balance:   ₹${toMoney(r.avgBalance)}`].join('\n');
      break;
    }
    case 'games': {
      const r = await reportsService.games();
      text = ['🎮 <b>Games</b>', '',
        `Poker running: ${r.poker.running}`, `Poker ended:   ${r.poker.ended}`].join('\n');
      break;
    }
    default:
      text = '❓ Unknown report';
  }
  await sendOrEdit(chatId, text, kb.build([backHomeRow(CB.reports)]), msgId);
}

// ─── Broadcast ───────────────────────────────────────────────────────────────
async function handleBroadcastMenu(chatId: number, telegramId: number, action: string, msgId?: number): Promise<void> {
  const typeMap: Record<string, BroadcastMediaType> = {
    text: 'text', image: 'image', video: 'video', pdf: 'pdf',
  };
  if (action === 'confirm') {
    const s = await sessionStore.get(telegramId);
    if (!s || !s.context.broadcast) {
      await sendOrEdit(chatId, '❌ Nothing to broadcast.', kb.build([backHomeRow(CB.broadcast)]), msgId);
      return;
    }
    const input = s.context.broadcast as BroadcastInput;
    await sessionStore.clear(telegramId);
    await sendOrEdit(chatId, '📢 Broadcasting… this may take a while.', kb.build([backHomeRow(CB.broadcast)]), msgId);
    const r = await broadcastService.send(input, telegramId);
    await telegram.sendMessage({
      chat_id: chatId,
      text: `📢 <b>Broadcast complete</b>\n\nAttempted: ${r.attempted}\nSucceeded: ${r.succeeded}\nFailed: ${r.failed}`,
      reply_markup: kb.build([backHomeRow(CB.broadcast)]),
    });
    return;
  }
  const type = typeMap[action];
  if (!type) {
    await sendOrEdit(chatId, '❓ Unknown broadcast type.', kb.build([backHomeRow(CB.broadcast)]), msgId);
    return;
  }
  await sessionStore.set(telegramId, chatId, 'broadcast:await_content', { type });
  const prompt = type === 'text'
    ? '📝 Send the broadcast <b>text</b> now.'
    : `📎 Send the ${type.toUpperCase()} as a URL <i>or</i> a file_id, followed by an optional caption on new lines.`;
  await telegram.sendMessage({
    chat_id: chatId,
    text: `${prompt}\n\nType /cancel to abort.`,
    parse_mode: 'HTML',
  });
}

async function handleBroadcastContent(chatId: number, telegramId: number, msg: TelegramMessage, ctx: Record<string, unknown>): Promise<void> {
  const type = String(ctx.type || 'text') as BroadcastMediaType;
  let content = '';
  let caption: string | undefined;

  if (type === 'text') {
    content = (msg.text || '').trim();
  } else if (msg.photo && msg.photo.length > 0) {
    content = msg.photo[msg.photo.length - 1]!.file_id;
    caption = msg.caption;
  } else if (msg.document) {
    content = msg.document.file_id;
    caption = msg.caption;
  } else if (msg.text) {
    // Assume URL in text; first line = URL, rest = caption.
    const parts = msg.text.split('\n');
    content = (parts[0] || '').trim();
    caption = parts.slice(1).join('\n').trim() || undefined;
  }

  if (!content) {
    await telegram.sendMessage({ chat_id: chatId, text: '❌ Empty broadcast. Try again.' });
    return;
  }

  const input: BroadcastInput = { type, content, caption };
  await sessionStore.set(telegramId, chatId, 'broadcast:await_confirm', { broadcast: input });

  const preview = [
    `📢 <b>Confirm Broadcast</b>`,
    '',
    `Type: <code>${type}</code>`,
    `Content: <code>${escapeHtml(truncate(content, 100))}</code>`,
    caption ? `Caption: ${escapeHtml(truncate(caption, 100))}` : '',
  ].filter(Boolean).join('\n');

  await telegram.sendMessage({
    chat_id: chatId, text: preview,
    reply_markup: kb.build([
      [kb.button('✅ Send Now', CB.broadcastConfirm), kb.button('❌ Cancel', CB.cancel)],
    ]),
  });
}

// ─── AI ──────────────────────────────────────────────────────────────────────
async function handleAiMenu(chatId: number, telegramId: number, action: string, msgId?: number): Promise<void> {
  const modeMap: Record<string, 'chat' | 'code' | 'logs' | 'debug'> = {
    chat: 'chat', code: 'code', logs: 'logs', debug: 'debug',
  };
  const mode = modeMap[action];
  if (!mode) return;
  await sessionStore.set(telegramId, chatId, 'ai:await_prompt', { mode });
  await telegram.sendMessage({
    chat_id: chatId,
    text: `🤖 AI mode: <b>${mode}</b>. Send your prompt.\n\nType /cancel to abort.`,
    parse_mode: 'HTML',
  });
}

async function handleAiPrompt(chatId: number, telegramId: number, text: string, ctx: Record<string, unknown>): Promise<void> {
  const mode = String(ctx.mode || 'chat') as 'chat' | 'code' | 'logs' | 'debug';
  await sessionStore.clear(telegramId);
  await telegram.sendMessage({ chat_id: chatId, text: '🤖 Thinking…' });
  const r = await aiService.ask(mode, text, telegramId);
  const reply = r.ok ? r.reply : `❌ ${r.error}`;
  await telegram.sendMessage({
    chat_id: chatId,
    text: `<b>AI (${mode})</b>\n\n${escapeHtml(truncate(reply, 3500))}`,
    parse_mode: 'HTML',
    reply_markup: kb.build([backHomeRow(CB.ai)]),
  });
}

// ─── Logs ────────────────────────────────────────────────────────────────────
async function renderLogs(chatId: number, msgId: number | undefined, mode: 'recent' | 'mine', telegramId?: number): Promise<void> {
  const list = mode === 'recent'
    ? await adminLogs.recent(20)
    : await adminLogs.byAdmin(telegramId!, 20);

  if (list.length === 0) {
    await sendOrEdit(chatId, '📋 <b>Logs</b>\n\n<i>No entries.</i>',
      kb.build([[kb.button('🔁 Recent', CB.logsRecent), kb.button('👤 Mine', CB.logsMine)], backHomeRow(CB.home)]), msgId);
    return;
  }
  const lines = list.map(l => {
    const when = new Date(l.createdAtMs || Date.now()).toISOString().slice(11, 19);
    const emoji = l.result === 'success' ? '✅' : '❌';
    return `${emoji} <code>${when}</code> ${escapeHtml(l.module)}:${escapeHtml(l.action)} ${l.target ? '→ ' + escapeHtml(truncate(l.target, 12)) : ''}`;
  }).join('\n');
  await sendOrEdit(chatId, `📋 <b>Logs — ${mode}</b>\n\n${lines}`,
    kb.build([[kb.button('🔁 Recent', CB.logsRecent), kb.button('👤 Mine', CB.logsMine)], backHomeRow(CB.home)]), msgId);
}
