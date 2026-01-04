import {
  User,
  DailyLog,
  Pattern,
  getRecentLogs,
  getUserPatterns,
} from '../db/queries';
import { query, queryOne } from '../db/client';

export interface Photo {
  id: string;
  user_id: string;
  type: 'baseline' | 'daily';
  url: string;
  date: string;
  created_at: Date;
}

export async function savePhoto(
  userId: string,
  type: 'baseline' | 'daily',
  url: string
): Promise<Photo> {
  const date = new Date().toISOString().split('T')[0];
  const rows = await query<Photo>(
    'INSERT INTO photos (user_id, type, url, date) VALUES ($1, $2, $3, $4) RETURNING *',
    [userId, type, url, date]
  );
  return rows[0];
}

export async function getBaselinePhoto(userId: string): Promise<Photo | null> {
  return queryOne<Photo>(
    "SELECT * FROM photos WHERE user_id = $1 AND type = 'baseline' ORDER BY created_at DESC LIMIT 1",
    [userId]
  );
}

export async function getRecentPhotos(userId: string, limit: number = 7): Promise<Photo[]> {
  return query<Photo>(
    "SELECT * FROM photos WHERE user_id = $1 AND type = 'daily' ORDER BY date DESC LIMIT $2",
    [userId, limit]
  );
}

export interface ShameEscalation {
  level: number;
  trigger: string;
  message: string;
  showBaseline: boolean;
  showRecent: boolean;
  actionRequired: string;
}

export async function determineShameEscalation(
  user: User,
  recentLogs: DailyLog[],
  patterns: Pattern[]
): Promise<ShameEscalation | null> {
  if (user.shame_level === 0) {
    return null; // Shame disabled
  }

  // Count recent failures
  const failedDays = recentLogs.filter(l => l.total_score < 5).length;
  const consecutiveFailures = countConsecutiveFailures(recentLogs);
  const missedLocks = recentLogs.filter(l => !l.tomorrow_locked).length;

  // Get repeat failure patterns
  const repeatExcuses = patterns.filter(
    p => p.pattern_type === 'miss_reason' && p.frequency >= 2
  );

  // Level 1: Baseline resurface (after single slip)
  if (user.shame_level >= 1 && failedDays >= 1 && failedDays <= 2) {
    return {
      level: 1,
      trigger: 'single_slip',
      message: `You slipped. Remember where you started.`,
      showBaseline: true,
      showRecent: false,
      actionRequired: "What's the ONE thing you'll do differently today?",
    };
  }

  // Level 2: Side-by-side pattern exposure (repeat failures)
  if (user.shame_level >= 2 && (consecutiveFailures >= 2 || repeatExcuses.length > 0)) {
    const excuse = repeatExcuses[0]?.content || 'no clear reason';
    return {
      level: 2,
      trigger: 'repeat_failure',
      message: `This is the ${consecutiveFailures > 1 ? consecutiveFailures + 'th' : '2nd'} time this week. The excuse: "${excuse}". Same pattern, same result.`,
      showBaseline: true,
      showRecent: true,
      actionRequired: "What will you do TODAY to break this pattern?",
    };
  }

  // Level 3: Baseline + recent "nothing changed" (rare, severe)
  if (user.shame_level >= 3 && failedDays >= 4) {
    return {
      level: 3,
      trigger: 'severe_pattern',
      message: `4+ days below target. Look at these photos. Nothing changed. The only person who can change this is you.`,
      showBaseline: true,
      showRecent: true,
      actionRequired: "Tell me what you're going to do RIGHT NOW.",
    };
  }

  return null;
}

function countConsecutiveFailures(logs: DailyLog[]): number {
  let count = 0;
  // Logs should be sorted by date DESC
  for (const log of logs) {
    if (log.total_score < 5) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

export async function handlePhotoMessage(
  user: User,
  mediaUrl: string
): Promise<string> {
  const baseline = await getBaselinePhoto(user.id);

  if (!baseline) {
    // This is the baseline photo
    await savePhoto(user.id, 'baseline', mediaUrl);
    return `Baseline photo saved.

This is your anchor. When you slip, you'll see this. When you succeed, you'll compare to this.

Take daily photos at the same time, same angle, same conditions.`;
  }

  // This is a daily photo
  await savePhoto(user.id, 'daily', mediaUrl);

  return `Daily photo logged.

Keep going. Consistency compounds.`;
}

export function generateShameMessage(escalation: ShameEscalation): string {
  return `${escalation.message}

${escalation.actionRequired}`;
}
