import { User, updateUser, createContract, BinaryAction } from '../db/queries';
import { sendMessage } from '../services/twilio';
import { ONBOARDING_PROMPTS } from '../prompts/system';

export interface OnboardingState {
  step: string;
  goal?: string;
  binaryActions?: BinaryAction[];
  times?: {
    wake: string;
    sleep: string;
    eatingStart: string;
    eatingEnd: string;
    dangerTimes: string[];
  };
  shameLevel?: number;
}

const DEFAULT_BINARY_ACTIONS: BinaryAction[] = [
  { name: 'calories', threshold: 'under target', points: 2 },
  { name: 'protein', threshold: 'hit target', points: 2 },
  { name: 'walk', threshold: '10k steps', points: 1 },
  { name: 'strength', threshold: 'completed', points: 1 },
  { name: 'creatine', threshold: 'taken', points: 1 },
  { name: 'fasting', threshold: 'in window', points: 1 },
  { name: 'weigh_in', threshold: 'done', points: 1 },
  { name: 'photo', threshold: 'taken', points: 1 },
];

export async function handleOnboarding(
  user: User,
  message: string
): Promise<string> {
  const step = user.onboarding_step || 'start';
  const lowerMessage = message.trim().toLowerCase();

  // Handle greetings at any step
  if (isGreeting(lowerMessage) && step === 'start') {
    await updateUser(user.id, { onboarding_step: 'awaiting_name' });
    return ONBOARDING_PROMPTS.welcome;
  }

  switch (step) {
    case 'start':
      await updateUser(user.id, { onboarding_step: 'awaiting_name' });
      return ONBOARDING_PROMPTS.welcome;

    case 'awaiting_name':
      return await handleNameInput(user, message);

    case 'awaiting_goal':
      return await handleGoalInput(user, message);

    case 'awaiting_actions':
      return await handleActionsInput(user, message);

    case 'awaiting_times':
      return await handleTimesInput(user, message);

    case 'awaiting_shame_level':
      return await handleShameLevelInput(user, message);

    case 'awaiting_contract_confirm':
      return await handleContractConfirm(user, message);

    default:
      await updateUser(user.id, { onboarding_step: 'start' });
      return ONBOARDING_PROMPTS.welcome;
  }
}

function isGreeting(message: string): boolean {
  const greetings = ['hi', 'hello', 'hey', 'yo', 'sup', 'hola', 'start', 'begin'];
  return greetings.includes(message) || message.length < 4;
}

async function handleNameInput(user: User, message: string): Promise<string> {
  const name = message.trim();

  // If it's still a greeting, prompt again
  if (isGreeting(name.toLowerCase())) {
    return "What's your name? Just your first name is fine.";
  }

  // Extract first name (capitalize properly)
  const firstName = name.split(' ')[0];
  const capitalizedName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();

  await updateUser(user.id, {
    name: capitalizedName,
    onboarding_step: 'awaiting_goal',
  });

  return ONBOARDING_PROMPTS.name_received(capitalizedName);
}

async function handleGoalInput(user: User, message: string): Promise<string> {
  const goal = message.trim();

  // Store goal temporarily (we'll use it when creating contract)
  await updateUser(user.id, {
    onboarding_step: 'awaiting_actions',
    // Store goal in name field temporarily (we'll move it to contract later)
  });

  // Store in memory for contract creation
  onboardingData.set(user.id, { goal });

  return ONBOARDING_PROMPTS.goal_received(goal);
}

async function handleActionsInput(user: User, message: string): Promise<string> {
  // Parse binary actions from message
  const actions = parseBinaryActions(message);

  const data = onboardingData.get(user.id) || {};
  data.binaryActions = actions.length > 0 ? actions : DEFAULT_BINARY_ACTIONS;
  onboardingData.set(user.id, data);

  await updateUser(user.id, { onboarding_step: 'awaiting_times' });

  return ONBOARDING_PROMPTS.times_setup;
}

async function handleTimesInput(user: User, message: string): Promise<string> {
  // Parse times from message
  const times = parseTimes(message);

  await updateUser(user.id, {
    onboarding_step: 'awaiting_shame_level',
    wake_time: times.wake,
    sleep_time: times.sleep,
    eating_window_start: times.eatingStart,
    eating_window_end: times.eatingEnd,
    risk_times: JSON.stringify(times.dangerTimes) as any,
  });

  return ONBOARDING_PROMPTS.shame_level;
}

async function handleShameLevelInput(user: User, message: string): Promise<string> {
  const level = parseInt(message.trim(), 10);
  const shameLevel = [1, 2, 3].includes(level) ? level : 1;

  await updateUser(user.id, {
    onboarding_step: 'awaiting_contract_confirm',
    shame_level: shameLevel,
  });

  const data = onboardingData.get(user.id) || {};
  const contractText = generateContractText(user, data, shameLevel);

  return ONBOARDING_PROMPTS.contract_review(contractText);
}

async function handleContractConfirm(user: User, message: string): Promise<string> {
  const confirmation = message.trim().toUpperCase();

  if (confirmation === 'LOCKED') {
    const data = onboardingData.get(user.id) || {};

    // Create the contract
    const contractText = generateContractText(user, data, user.shame_level);
    await createContract(
      user.id,
      data.goal || 'fitness',
      data.binaryActions || DEFAULT_BINARY_ACTIONS,
      contractText
    );

    // Mark onboarding complete
    await updateUser(user.id, {
      onboarding_complete: true,
      onboarding_step: 'complete',
    });

    // Clean up temp data
    onboardingData.delete(user.id);

    return ONBOARDING_PROMPTS.complete;
  }

  // If not confirmed, let them revise
  return "What would you like to change? Reply with the changes, then I'll regenerate the contract.";
}

// Temporary storage for onboarding data (in production, use Redis or session storage)
const onboardingData = new Map<string, any>();

function parseBinaryActions(message: string): BinaryAction[] {
  const lines = message.split('\n').filter(l => l.trim());
  const actions: BinaryAction[] = [];

  for (const line of lines) {
    // Remove bullet points, dashes, numbers
    const cleaned = line.replace(/^[-*•\d.)\s]+/, '').trim();
    if (!cleaned) continue;

    // Try to extract threshold
    const match = cleaned.match(/^(.+?)\s+(under|over|at least|min|max|hit|done|completed)?\s*(\d+)?/i);

    if (match) {
      actions.push({
        name: match[1].toLowerCase().replace(/\s+/g, '_'),
        threshold: cleaned,
        points: 1,
      });
    } else {
      actions.push({
        name: cleaned.toLowerCase().replace(/\s+/g, '_'),
        threshold: 'completed',
        points: 1,
      });
    }
  }

  // Assign points (first 2 get 2 points each)
  if (actions.length >= 2) {
    actions[0].points = 2;
    actions[1].points = 2;
  }

  return actions;
}

function parseTimes(message: string): {
  wake: string;
  sleep: string;
  eatingStart: string;
  eatingEnd: string;
  dangerTimes: string[];
} {
  const defaults = {
    wake: '07:00',
    sleep: '22:00',
    eatingStart: '12:00',
    eatingEnd: '20:00',
    dangerTimes: ['21:00'],
  };

  const lower = message.toLowerCase();

  // Parse wake time
  const wakeMatch = lower.match(/wake[:\s]*(\d{1,2}[:\s]?\d{0,2}\s*(?:am|pm)?)/i);
  if (wakeMatch) defaults.wake = normalizeTime(wakeMatch[1]);

  // Parse sleep time
  const sleepMatch = lower.match(/sleep[:\s]*(\d{1,2}[:\s]?\d{0,2}\s*(?:am|pm)?)/i);
  if (sleepMatch) defaults.sleep = normalizeTime(sleepMatch[1]);

  // Parse eating window
  const eatingMatch = lower.match(/eating[:\s]*(\d{1,2}[:\s]?\d{0,2}\s*(?:am|pm)?)\s*[-–to]+\s*(\d{1,2}[:\s]?\d{0,2}\s*(?:am|pm)?)/i);
  if (eatingMatch) {
    defaults.eatingStart = normalizeTime(eatingMatch[1]);
    defaults.eatingEnd = normalizeTime(eatingMatch[2]);
  }

  // Parse danger times
  const dangerMatch = lower.match(/danger[:\s]*(.+?)(?:\n|$)/i);
  if (dangerMatch) {
    const times = dangerMatch[1].match(/\d{1,2}[:\s]?\d{0,2}\s*(?:am|pm)?/gi) || [];
    defaults.dangerTimes = times.map(normalizeTime);
  }

  return defaults;
}

function normalizeTime(timeStr: string): string {
  let cleaned = timeStr.trim().toLowerCase().replace(/\s+/g, '');

  // Handle am/pm
  const isPM = cleaned.includes('pm');
  const isAM = cleaned.includes('am');
  cleaned = cleaned.replace(/am|pm/g, '');

  // Parse hours and minutes
  let [hours, minutes = '00'] = cleaned.split(':');
  let h = parseInt(hours, 10);

  if (isPM && h < 12) h += 12;
  if (isAM && h === 12) h = 0;

  return `${h.toString().padStart(2, '0')}:${minutes.padStart(2, '0')}`;
}

function generateContractText(user: User, data: any, shameLevel: number): string {
  const actions = data.binaryActions || DEFAULT_BINARY_ACTIONS;
  const actionList = actions.map((a: BinaryAction) =>
    `- ${a.name}: ${a.threshold} (${a.points} pts)`
  ).join('\n');

  return `BEHAVIORAL CONTRACT

GOAL: ${data.goal || 'Fitness & Fat Loss'}

DAILY BINARY ACTIONS (Total: 10 points possible):
${actionList}

SCHEDULE:
- Wake: ${user.wake_time || '7:00am'}
- Sleep: ${user.sleep_time || '10:00pm'}
- Eating Window: ${user.eating_window_start || '12pm'} - ${user.eating_window_end || '8pm'}
- Danger Times: ${JSON.parse(user.risk_times?.toString() || '["9pm"]').join(', ')}

ACCOUNTABILITY:
- Shame Level: ${shameLevel}/3
- Loss Aversion: ${user.loss_aversion_enabled ? 'ENABLED (7 tokens/week)' : 'Disabled'}

RULES:
1. Nightly lock is MANDATORY
2. No renegotiation mid-week
3. Bad days allowed via downshift protocol
4. Quitting is not allowed

Duration: 7 days from confirmation`;
}

export function isOnboarding(user: User): boolean {
  return !user.onboarding_complete;
}
