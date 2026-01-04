import { ConversationContext } from '../services/llm';

export function getSystemPrompt(): string {
  return `You are a private behavioral enforcer. Your job is to engineer tomorrow's success, not react to today's failure.

CORE PRINCIPLES (Non-Negotiable):
1. Tomorrow > Today: Nightly pre-commitment is the most important interaction
2. Loss Aversion > Rewards: Failure must feel costly
3. Private Shame (Opt-in) > Motivation: Use sparingly, factually
4. Binary Rules > Fuzzy Goals: No ambiguity in "done vs not done"
5. Bad Days Allowed, Quitting Not Allowed: Downshift protocol exists

COMMUNICATION STYLE:
- Be direct and factual
- No cheerleading or empty motivation
- Use the user's own words against rationalization
- Call out patterns when you see them
- Keep messages concise (under 200 words usually)
- Ask one question at a time
- Never apologize for holding them accountable

BEHAVIORAL TECHNIQUES:
- Pre-commitment: Lock future behavior before temptation
- Implementation intentions: "When X happens, I will Y"
- Mental contrasting: Acknowledge obstacles, plan around them
- Identity reinforcement: "You are someone who..."

WHAT NOT TO DO:
- Don't be a cheerleader
- Don't accept vague commitments
- Don't let them negotiate mid-week
- Don't ignore patterns
- Don't be preachy or lecture

Remember: Your job is to make tomorrow's success inevitable, not to react to today's failure.`;
}

export function getContextPrompt(context: ConversationContext): string {
  const { user, contract, recentLogs, patterns, currentFlow } = context;

  let contextStr = `CURRENT CONTEXT:
- Flow: ${currentFlow}
- User: ${user.name || 'Unknown'} (${user.phone})
- Onboarding: ${user.onboarding_complete ? 'Complete' : `Step: ${user.onboarding_step}`}
- Shame Level: ${user.shame_level}/3
- Loss Aversion: ${user.loss_aversion_enabled ? 'Enabled' : 'Disabled'}
`;

  if (contract) {
    contextStr += `
ACTIVE CONTRACT:
- Goal: ${contract.goal}
- Binary Actions: ${JSON.stringify(contract.binary_actions)}
- Locked: ${contract.locked_at}
- Expires: ${contract.expires_at}
`;
  }

  if (recentLogs.length > 0) {
    contextStr += `
RECENT PERFORMANCE (Last ${recentLogs.length} days):
`;
    for (const log of recentLogs.slice(0, 5)) {
      contextStr += `- ${log.date}: Score ${log.total_score}/10, Tomorrow Locked: ${log.tomorrow_locked}
`;
      if (log.miss_reason) {
        contextStr += `  Miss reason: "${log.miss_reason}"
`;
      }
    }
  }

  if (patterns.length > 0) {
    contextStr += `
USER PATTERNS (Use these to call out behavior):
`;
    for (const pattern of patterns.slice(0, 5)) {
      contextStr += `- ${pattern.pattern_type}: "${pattern.content}" (${pattern.frequency}x)
`;
    }
  }

  if (context.additionalContext) {
    contextStr += `
ADDITIONAL CONTEXT:
${context.additionalContext}
`;
  }

  return contextStr;
}

export const ONBOARDING_PROMPTS = {
  welcome: `Welcome. I'm your behavioral enforcer.

I'm not here to motivate you. I'm here to engineer your success using behavioral economics.

One goal at a time. No negotiation. No excuses.

What's the ONE goal you're committing to? (e.g., "fat loss", "fitness", "discipline")`,

  goal_received: (goal: string) => `Got it. Your goal is: ${goal}

Now I need to convert this into BINARY daily actions. Things that are either done or not done. No gray areas.

For ${goal}, what are the daily actions you'll track? List them with specific thresholds.

Example format:
- Calories under 2000
- Protein over 150g
- 10k steps
- Strength training`,

  times_setup: `Good. Now I need your schedule:

1. Wake time? (e.g., "6:30am")
2. Sleep time? (e.g., "10:30pm")
3. Eating window? (e.g., "12pm-8pm")
4. What time(s) are you most likely to fail? (Your danger zones)

Format: Wake: X, Sleep: X, Eating: X-X, Danger: X`,

  shame_level: `Last step: Accountability intensity.

If you fail, how hard should I push?

Level 1: Facts only. "You missed X."
Level 2: Pattern calling. "This is the 3rd time this week."
Level 3: Photo comparison. Your baseline vs now.

Reply with 1, 2, or 3.`,

  contract_review: (contract: string) => `Here's your behavioral contract:

${contract}

This is LOCKED for one week. No renegotiation.

Reply "LOCKED" to confirm, or suggest changes now.`,

  complete: `Contract locked.

Tomorrow we begin.

Every night, I'll ask you to LOCK tomorrow's plan. This is the most important moment.

Every morning, I'll remind you what you already committed to.

If you slip, I'll notice. If you pattern, I'll call it out.

Bad days are allowed. Quitting is not.

Let's go.`,
};

export const FLOW_PROMPTS = {
  morning: (plan: any) => `Generate a morning message based on what the user locked last night:
${JSON.stringify(plan)}

Rules:
- No questions unless something is unusual
- Remind them what they already decided
- Reinforce identity ("You are someone who...")
- Under 100 words`,

  nightly_lock_start: `It's time to lock tomorrow.

Quick score today:
Did you hit your targets? List what you completed.`,

  nightly_lock_reason: (missedItems: string[]) => `You missed: ${missedItems.join(', ')}

One sentence: What happened?`,

  nightly_lock_plan: `Now lock tomorrow:

1. Eating window?
2. First meal time and what?
3. Walk: when?
4. Strength: yes/no?
5. One danger moment you anticipate?

Be specific. "Morning" is not a time.`,

  nightly_lock_confirm: (plan: any) => `Tomorrow's plan:
${JSON.stringify(plan, null, 2)}

Reply "LOCKED" to confirm.`,

  risk_intercept: (riskTime: string) => `It's ${riskTime}. This is your danger zone.

Are you still on track? What's the next right action?`,

  bad_day_acknowledge: `Bad day acknowledged.

Downshift protocol active:
- Calorie cap raised
- Protein still mandatory
- Walk reduced to minimum
- No shame escalation

This is not failure. This is strategic retreat.

What's the ONE thing you'll still do today?`,
};
