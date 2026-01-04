import {
  User,
  Contract,
  DailyLog,
  BinaryAction,
  getTodayLog,
  getRecentLogs,
  upsertDailyLog,
} from '../db/queries';

export interface ScoreUpdate {
  action: string;
  completed: boolean;
  value?: number | string;
}

export async function updateScore(
  user: User,
  contract: Contract,
  update: ScoreUpdate
): Promise<{ newScore: number; totalPossible: number; message: string }> {
  const today = new Date().toISOString().split('T')[0];
  let log = await getTodayLog(user.id);

  const scores: Record<string, number> = log?.scores || {};
  const action = contract.binary_actions.find(
    a => a.name.toLowerCase() === update.action.toLowerCase()
  );

  if (!action) {
    return {
      newScore: 0,
      totalPossible: 0,
      message: `Unknown action: ${update.action}`,
    };
  }

  scores[action.name] = update.completed ? action.points : 0;
  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
  const totalPossible = contract.binary_actions.reduce((a, b) => a + b.points, 0);

  await upsertDailyLog(user.id, today, {
    scores,
    total_score: totalScore,
  });

  const emoji = update.completed ? '✓' : '✗';
  const message = `${emoji} ${action.name}: ${update.completed ? action.points : 0}/${action.points} pts

Today: ${totalScore}/${totalPossible}`;

  return { newScore: totalScore, totalPossible, message };
}

export async function getCurrentScore(
  user: User,
  contract: Contract
): Promise<string> {
  const log = await getTodayLog(user.id);
  const scores: Record<string, number> = log?.scores || {};
  const totalPossible = contract.binary_actions.reduce((a, b) => a + b.points, 0);
  const currentScore = log?.total_score || 0;

  let statusLines: string[] = [];

  for (const action of contract.binary_actions) {
    const score = scores[action.name] ?? 0;
    const emoji = score > 0 ? '✓' : '○';
    statusLines.push(`${emoji} ${action.name}: ${score}/${action.points}`);
  }

  return `Today's scorecard:

${statusLines.join('\n')}

Total: ${currentScore}/${totalPossible}`;
}

export async function getWeeklyReport(
  user: User,
  contract: Contract
): Promise<string> {
  const logs = await getRecentLogs(user.id, 7);
  const totalPossible = contract.binary_actions.reduce((a, b) => a + b.points, 0);

  if (logs.length === 0) {
    return "No data for this week yet.";
  }

  let report = "Weekly Report:\n\n";

  // Daily breakdown
  for (const log of logs.reverse()) {
    const locked = log.tomorrow_locked ? '🔒' : '○';
    report += `${log.date}: ${log.total_score}/${totalPossible} ${locked}\n`;
  }

  // Weekly stats
  const totalScored = logs.reduce((a, b) => a + b.total_score, 0);
  const maxPossible = logs.length * totalPossible;
  const percentage = Math.round((totalScored / maxPossible) * 100);
  const lockedCount = logs.filter(l => l.tomorrow_locked).length;

  report += `\n---\nWeek: ${totalScored}/${maxPossible} (${percentage}%)`;
  report += `\nLocked nights: ${lockedCount}/${logs.length}`;

  // Identify patterns
  const missedByAction: Record<string, number> = {};
  for (const log of logs) {
    for (const action of contract.binary_actions) {
      if (!log.scores[action.name] || log.scores[action.name] === 0) {
        missedByAction[action.name] = (missedByAction[action.name] || 0) + 1;
      }
    }
  }

  const problemAreas = Object.entries(missedByAction)
    .filter(([_, count]) => count >= 3)
    .map(([name, count]) => `${name} (missed ${count}x)`);

  if (problemAreas.length > 0) {
    report += `\n\n⚠️ Problem areas: ${problemAreas.join(', ')}`;
  }

  return report;
}

export function parseScoreUpdate(
  message: string,
  contract: Contract
): ScoreUpdate | null {
  const lower = message.toLowerCase();

  // Check for common patterns
  const positivePatterns = [
    'did', 'done', 'hit', 'completed', 'finished', '✓', 'yes', 'checked',
  ];
  const negativePatterns = ['missed', 'skip', 'didn\'t', 'failed', 'no'];

  let completed = true;
  if (negativePatterns.some(p => lower.includes(p))) {
    completed = false;
  }

  // Find which action they're referring to
  for (const action of contract.binary_actions) {
    const actionLower = action.name.toLowerCase();
    const actionWords = actionLower.split('_');

    if (
      lower.includes(actionLower) ||
      lower.includes(actionLower.replace('_', ' ')) ||
      actionWords.some(w => w.length > 3 && lower.includes(w))
    ) {
      return { action: action.name, completed };
    }
  }

  // Check for numeric values (calories, protein, steps)
  const calorieMatch = lower.match(/(\d{3,4})\s*(?:cal|kcal|calories)/);
  if (calorieMatch) {
    return {
      action: 'calories',
      completed: true,
      value: parseInt(calorieMatch[1], 10),
    };
  }

  const proteinMatch = lower.match(/(\d{2,3})\s*(?:g|gram|protein)/);
  if (proteinMatch) {
    return {
      action: 'protein',
      completed: true,
      value: parseInt(proteinMatch[1], 10),
    };
  }

  const stepsMatch = lower.match(/(\d{4,5})\s*(?:steps|k)/);
  if (stepsMatch) {
    return {
      action: 'walk',
      completed: parseInt(stepsMatch[1], 10) >= 10000,
      value: parseInt(stepsMatch[1], 10),
    };
  }

  return null;
}
