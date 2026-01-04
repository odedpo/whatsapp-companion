import {
  User,
  Contract,
  DailyLog,
  getTodayLog,
  upsertDailyLog,
  recordPattern,
} from '../db/queries';
import { generateFlowResponse, ConversationContext } from '../services/llm';
import { FLOW_PROMPTS } from '../prompts/system';

export interface NightlyLockState {
  step: 'start' | 'scoring' | 'miss_reason' | 'planning' | 'confirm';
  todayScores?: Record<string, number>;
  missedItems?: string[];
  missReason?: string;
  tomorrowPlan?: TomorrowPlan;
}

export interface TomorrowPlan {
  eating_window: string;
  first_meal: string;
  walk_time: string;
  strength: boolean;
  danger_moment: string;
}

// In-memory state for nightly lock flow (use Redis in production)
const nightlyLockState = new Map<string, NightlyLockState>();

export async function handleNightlyLock(
  user: User,
  contract: Contract,
  message: string,
  context: ConversationContext
): Promise<string> {
  let state = nightlyLockState.get(user.id) || { step: 'start' };

  switch (state.step) {
    case 'start':
      return await startNightlyLock(user, contract);

    case 'scoring':
      return await handleScoring(user, contract, message, state);

    case 'miss_reason':
      return await handleMissReason(user, message, state);

    case 'planning':
      return await handlePlanning(user, message, state);

    case 'confirm':
      return await handleConfirm(user, message, state, context);

    default:
      return await startNightlyLock(user, contract);
  }
}

async function startNightlyLock(user: User, contract: Contract): Promise<string> {
  nightlyLockState.set(user.id, { step: 'scoring' });

  const actions = contract.binary_actions;
  const actionList = actions.map(a => `- ${a.name}`).join('\n');

  return `Time to lock tomorrow.

First, score today. Which of these did you complete?

${actionList}

Reply with what you hit (e.g., "calories, protein, walk") or "all" / "none".`;
}

async function handleScoring(
  user: User,
  contract: Contract,
  message: string,
  state: NightlyLockState
): Promise<string> {
  const lower = message.toLowerCase();
  const actions = contract.binary_actions;

  let completedItems: string[] = [];
  let missedItems: string[] = [];

  if (lower === 'all') {
    completedItems = actions.map(a => a.name);
  } else if (lower === 'none') {
    missedItems = actions.map(a => a.name);
  } else {
    // Parse which items were mentioned
    for (const action of actions) {
      const actionLower = action.name.toLowerCase();
      if (lower.includes(actionLower) || lower.includes(actionLower.replace('_', ' '))) {
        completedItems.push(action.name);
      } else {
        missedItems.push(action.name);
      }
    }

    // If nothing was parsed, assume they listed completions
    if (completedItems.length === 0) {
      const words = lower.split(/[,\s]+/).filter(w => w.length > 2);
      for (const action of actions) {
        const found = words.some(w =>
          action.name.toLowerCase().includes(w) ||
          w.includes(action.name.toLowerCase().substring(0, 4))
        );
        if (found) {
          completedItems.push(action.name);
        } else {
          missedItems.push(action.name);
        }
      }
    }
  }

  // Calculate scores
  const scores: Record<string, number> = {};
  let totalScore = 0;

  for (const action of actions) {
    if (completedItems.includes(action.name)) {
      scores[action.name] = action.points;
      totalScore += action.points;
    } else {
      scores[action.name] = 0;
    }
  }

  // Save today's log
  const today = new Date().toISOString().split('T')[0];
  await upsertDailyLog(user.id, today, {
    scores,
    total_score: totalScore,
  });

  state.todayScores = scores;
  state.missedItems = missedItems;

  if (missedItems.length > 0) {
    state.step = 'miss_reason';
    nightlyLockState.set(user.id, state);

    return FLOW_PROMPTS.nightly_lock_reason(missedItems);
  }

  // No misses, go straight to planning
  state.step = 'planning';
  nightlyLockState.set(user.id, state);

  return `Perfect day. ${totalScore}/10.

${FLOW_PROMPTS.nightly_lock_plan}`;
}

async function handleMissReason(
  user: User,
  message: string,
  state: NightlyLockState
): Promise<string> {
  state.missReason = message.trim();

  // Record the pattern
  await recordPattern(user.id, 'miss_reason', message.trim());

  // Also record time-based pattern if detectable
  const timeMatch = message.match(/(\d{1,2}[:\s]?\d{0,2}\s*(?:am|pm)?)/i);
  if (timeMatch) {
    await recordPattern(user.id, 'failure_time', timeMatch[1]);
  }

  state.step = 'planning';
  nightlyLockState.set(user.id, state);

  return `Noted: "${message.trim()}"

${FLOW_PROMPTS.nightly_lock_plan}`;
}

async function handlePlanning(
  user: User,
  message: string,
  state: NightlyLockState
): Promise<string> {
  // Parse tomorrow's plan
  const plan = parseTomorrowPlan(message);
  state.tomorrowPlan = plan;
  state.step = 'confirm';
  nightlyLockState.set(user.id, state);

  return `Tomorrow's plan:

📍 Eating: ${plan.eating_window}
🍽️ First meal: ${plan.first_meal}
🚶 Walk: ${plan.walk_time}
💪 Strength: ${plan.strength ? 'YES' : 'NO'}
⚠️ Danger: ${plan.danger_moment}

Reply "LOCKED" to confirm.`;
}

async function handleConfirm(
  user: User,
  message: string,
  state: NightlyLockState,
  context: ConversationContext
): Promise<string> {
  const confirmation = message.trim().toUpperCase();

  if (confirmation === 'LOCKED') {
    // Save tomorrow's plan
    const today = new Date().toISOString().split('T')[0];
    await upsertDailyLog(user.id, today, {
      tomorrow_locked: true,
      tomorrow_plan: state.tomorrowPlan as any,
      miss_reason: state.missReason || null,
    });

    // Clean up state
    nightlyLockState.delete(user.id);

    const score = state.todayScores
      ? Object.values(state.todayScores).reduce((a, b) => a + b, 0)
      : 0;

    return `Locked. ✓

Today: ${score}/10
Tomorrow is already decided.

Sleep well. I'll remind you in the morning.`;
  }

  // They want to change something
  state.step = 'planning';
  nightlyLockState.set(user.id, state);

  return "What do you want to change? Give me the full plan again.";
}

function parseTomorrowPlan(message: string): TomorrowPlan {
  const defaults: TomorrowPlan = {
    eating_window: '12pm-8pm',
    first_meal: '12pm',
    walk_time: 'morning',
    strength: false,
    danger_moment: 'evening',
  };

  const lower = message.toLowerCase();

  // Parse eating window
  const eatingMatch = lower.match(/eat(?:ing)?[:\s]*(\d{1,2}[:\s]?\d{0,2}\s*(?:am|pm)?)\s*[-–to]+\s*(\d{1,2}[:\s]?\d{0,2}\s*(?:am|pm)?)/i);
  if (eatingMatch) {
    defaults.eating_window = `${eatingMatch[1]}-${eatingMatch[2]}`;
  }

  // Parse first meal
  const firstMatch = lower.match(/first[:\s]*(.+?)(?:\n|$)/i);
  if (firstMatch) {
    defaults.first_meal = firstMatch[1].trim();
  }

  // Parse walk time
  const walkMatch = lower.match(/walk[:\s]*(.+?)(?:\n|$)/i);
  if (walkMatch) {
    defaults.walk_time = walkMatch[1].trim();
  }

  // Parse strength
  defaults.strength = /strength[:\s]*(?:yes|y|✓|true)/i.test(lower);

  // Parse danger moment
  const dangerMatch = lower.match(/danger[:\s]*(.+?)(?:\n|$)/i);
  if (dangerMatch) {
    defaults.danger_moment = dangerMatch[1].trim();
  }

  return defaults;
}

export function isInNightlyLock(userId: string): boolean {
  return nightlyLockState.has(userId);
}

export function resetNightlyLock(userId: string): void {
  nightlyLockState.delete(userId);
}
