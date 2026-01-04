import {
  User,
  TokenRecord,
  DailyLog,
  getOrCreateWeekTokens,
  deductToken,
  getCurrentWeekTokens,
} from '../db/queries';

export interface TokenStatus {
  current: number;
  starting: number;
  lossEvents: Array<{ date: string; reason: string; amount: number }>;
  punishmentTriggered: boolean;
}

export async function getTokenStatus(user: User): Promise<TokenStatus> {
  const tokens = await getOrCreateWeekTokens(user.id);

  return {
    current: tokens.current_tokens,
    starting: tokens.starting_tokens,
    lossEvents: tokens.loss_events,
    punishmentTriggered: tokens.punishment_triggered,
  };
}

export async function processFailure(
  user: User,
  reason: string,
  severity: 'minor' | 'major' = 'minor'
): Promise<string> {
  if (!user.loss_aversion_enabled) {
    return '';
  }

  const amount = severity === 'major' ? 2 : 1;
  const tokens = await deductToken(user.id, reason, amount);

  if (tokens.punishment_triggered) {
    return `🚨 ZERO TOKENS

You've lost all 7 tokens this week.

The pre-agreed punishment is now active.

This is the cost of breaking your commitment.

Next week starts fresh. But this week, you pay the price.`;
  }

  const remaining = tokens.current_tokens;
  const emoji = remaining <= 2 ? '⚠️' : '📉';

  return `${emoji} Token lost: ${reason}

Remaining this week: ${remaining}/7

${remaining <= 2 ? 'You\'re running low. Every action counts now.' : ''}`;
}

export async function checkDailyFailures(
  user: User,
  todayLog: DailyLog,
  totalPossible: number
): Promise<string[]> {
  const messages: string[] = [];

  if (!user.loss_aversion_enabled) {
    return messages;
  }

  // Calculate failure threshold (below 50%)
  const threshold = totalPossible * 0.5;

  if (todayLog.total_score < threshold) {
    const msg = await processFailure(
      user,
      `Score ${todayLog.total_score}/${totalPossible}`,
      'minor'
    );
    if (msg) messages.push(msg);
  }

  // Check for missed nightly lock
  if (!todayLog.tomorrow_locked) {
    const msg = await processFailure(
      user,
      'Missed nightly lock',
      'major'
    );
    if (msg) messages.push(msg);
  }

  return messages;
}

export function generateTokenStatusMessage(status: TokenStatus): string {
  const { current, starting, lossEvents, punishmentTriggered } = status;

  if (punishmentTriggered) {
    return `⛔ Tokens: 0/${starting}
Punishment active this week.`;
  }

  let message = `💰 Tokens: ${current}/${starting}`;

  if (lossEvents.length > 0) {
    message += '\n\nLosses this week:';
    for (const event of lossEvents.slice(-3)) {
      message += `\n- ${event.date}: ${event.reason} (-${event.amount})`;
    }
  }

  if (current <= 2) {
    message += '\n\n⚠️ Running low. Stay sharp.';
  }

  return message;
}

export async function resetWeeklyTokens(user: User): Promise<void> {
  // This is called by scheduler at start of week
  // The getOrCreateWeekTokens handles creating fresh tokens for new week
  await getOrCreateWeekTokens(user.id);
}
