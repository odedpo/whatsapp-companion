import { User, Contract, upsertDailyLog, recordPattern } from '../db/queries';

export interface DownshiftRules {
  caloriesMultiplier: number; // e.g., 1.25 = 25% more
  proteinMandatory: boolean;
  walkReduced: boolean;
  strengthOptional: boolean;
  noShameEscalation: boolean;
}

const DEFAULT_DOWNSHIFT: DownshiftRules = {
  caloriesMultiplier: 1.25, // Allow 25% more calories
  proteinMandatory: true,
  walkReduced: true, // Reduced to 5k instead of 10k
  strengthOptional: true,
  noShameEscalation: true,
};

export async function handleBadDay(
  user: User,
  contract: Contract,
  reason?: string
): Promise<string> {
  const today = new Date().toISOString().split('T')[0];

  // Record the bad day pattern
  await recordPattern(user.id, 'bad_day', reason || 'declared bad day');

  // Update today's log to indicate downshift mode
  await upsertDailyLog(user.id, today, {
    notes: `DOWNSHIFT: ${reason || 'bad day declared'}`,
  });

  // Generate modified targets
  const baseCalories = extractCalorieTarget(contract);
  const newCalories = Math.round(baseCalories * DEFAULT_DOWNSHIFT.caloriesMultiplier);

  return `Bad day acknowledged.

Downshift protocol active:

✓ Calories: ${newCalories} (up from ${baseCalories})
✓ Protein: STILL MANDATORY
✓ Walk: Reduced to 5k minimum
✓ Strength: Optional today
✓ No shame escalation

This is not failure. This is strategic retreat.

What's the ONE thing you'll still accomplish today?`;
}

export function detectBadDayRequest(message: string): boolean {
  const lower = message.toLowerCase();

  const triggers = [
    'bad day',
    'hard day',
    'rough day',
    'terrible day',
    'can\'t today',
    'struggling',
    'need a break',
    'downshift',
    'not feeling it',
    'overwhelmed',
    'exhausted',
    'burnt out',
    'burnout',
  ];

  return triggers.some(t => lower.includes(t));
}

export function getDownshiftRules(): DownshiftRules {
  return { ...DEFAULT_DOWNSHIFT };
}

function extractCalorieTarget(contract: Contract): number {
  const calorieAction = contract.binary_actions.find(
    a => a.name.toLowerCase().includes('calorie')
  );

  if (calorieAction?.threshold) {
    const match = calorieAction.threshold.match(/(\d{3,4})/);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  return 2000; // Default
}

export function isDownshiftDay(notes: string | null): boolean {
  return notes?.includes('DOWNSHIFT') || false;
}

export async function handleDownshiftCompletion(
  user: User,
  oneThingDone: string
): Promise<string> {
  const today = new Date().toISOString().split('T')[0];

  await recordPattern(user.id, 'downshift_completion', oneThingDone);

  await upsertDailyLog(user.id, today, {
    notes: `DOWNSHIFT completed: ${oneThingDone}`,
  });

  return `Good. You did: "${oneThingDone}"

On bad days, doing ONE thing is a win.

Tomorrow we reset. Tonight, lock your plan as usual.`;
}
