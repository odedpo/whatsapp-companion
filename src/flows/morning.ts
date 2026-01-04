import { User, Contract, DailyLog, getYesterdayLog } from '../db/queries';
import { generateFlowResponse, ConversationContext } from '../services/llm';
import { FLOW_PROMPTS } from '../prompts/system';

export async function generateMorningMessage(
  user: User,
  contract: Contract,
  context: ConversationContext
): Promise<string> {
  const yesterdayLog = await getYesterdayLog(user.id);

  if (!yesterdayLog || !yesterdayLog.tomorrow_locked || !yesterdayLog.tomorrow_plan) {
    // No locked plan from last night
    return `Good morning.

You didn't lock yesterday. That's a pattern worth noticing.

What's the plan for today? Be specific.`;
  }

  const plan = yesterdayLog.tomorrow_plan;

  // Generate declarative reminder
  return `Good morning.

You already decided:

📍 Eating: ${plan.eating_window}
🍽️ First meal: ${plan.first_meal}
🚶 Walk: ${plan.walk_time}
💪 Strength: ${plan.strength ? 'YES' : 'NO'}
⚠️ Watch for: ${plan.danger_moment}

You are someone who does what they say.

Execute.`;
}

export async function generateMorningMessageWithLLM(
  user: User,
  contract: Contract,
  context: ConversationContext
): Promise<string> {
  const yesterdayLog = await getYesterdayLog(user.id);

  if (!yesterdayLog?.tomorrow_plan) {
    return generateFlowResponse(context, `
Generate a morning message for a user who didn't lock their plan last night.
Be direct about this being a pattern issue.
Ask them to commit to today's plan now.
Keep it under 100 words.`);
  }

  return generateFlowResponse(
    context,
    FLOW_PROMPTS.morning(yesterdayLog.tomorrow_plan)
  );
}
