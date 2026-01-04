import * as cron from 'node-cron';
import { query } from '../db/client';
import { User, Contract, getActiveContract, getRecentLogs, getUserPatterns } from '../db/queries';
import { sendMessage } from './twilio';
import { generateMorningMessage } from '../flows/morning';
import { ConversationContext } from './llm';
import { buildMemoryContext } from './memory';

interface ScheduledJob {
  id: string;
  userId: string;
  type: 'morning' | 'nightly' | 'risk';
  time: string;
  task: ReturnType<typeof cron.schedule>;
}

const scheduledJobs: Map<string, ScheduledJob[]> = new Map();

export async function initializeScheduler(): Promise<void> {
  console.log('Initializing scheduler...');

  // Load all users with completed onboarding
  const users = await query<User>(
    'SELECT * FROM users WHERE onboarding_complete = true'
  );

  for (const user of users) {
    await scheduleUserJobs(user);
  }

  // Schedule weekly token reset (Monday at midnight)
  cron.schedule('0 0 * * 1', async () => {
    console.log('Weekly token reset...');
    // Tokens auto-reset when getOrCreateWeekTokens is called
  });

  console.log(`Scheduler initialized for ${users.length} users`);
}

export async function scheduleUserJobs(user: User): Promise<void> {
  // Cancel existing jobs for this user
  cancelUserJobs(user.id);

  const jobs: ScheduledJob[] = [];

  // Morning message
  if (user.wake_time) {
    const [hours, minutes] = parseTime(user.wake_time);
    const cronTime = `${minutes} ${hours} * * *`;

    const task = cron.schedule(cronTime, async () => {
      await sendMorningMessage(user);
    });

    jobs.push({
      id: `morning-${user.id}`,
      userId: user.id,
      type: 'morning',
      time: user.wake_time,
      task,
    });

    console.log(`Scheduled morning message for ${user.phone} at ${user.wake_time}`);
  }

  // Nightly lock reminder (2 hours before sleep)
  if (user.sleep_time) {
    const [hours, minutes] = parseTime(user.sleep_time);
    const nightlyHour = (hours - 2 + 24) % 24;
    const cronTime = `${minutes} ${nightlyHour} * * *`;

    const task = cron.schedule(cronTime, async () => {
      await sendNightlyReminder(user);
    });

    jobs.push({
      id: `nightly-${user.id}`,
      userId: user.id,
      type: 'nightly',
      time: `${nightlyHour}:${minutes.toString().padStart(2, '0')}`,
      task,
    });

    console.log(`Scheduled nightly reminder for ${user.phone} at ${nightlyHour}:${minutes}`);
  }

  // Risk window intercepts
  const riskTimes = JSON.parse(user.risk_times?.toString() || '[]') as string[];
  for (const riskTime of riskTimes) {
    const [hours, minutes] = parseTime(riskTime);
    const cronTime = `${minutes} ${hours} * * *`;

    const task = cron.schedule(cronTime, async () => {
      await sendRiskIntercept(user, riskTime);
    });

    jobs.push({
      id: `risk-${user.id}-${riskTime}`,
      userId: user.id,
      type: 'risk',
      time: riskTime,
      task,
    });

    console.log(`Scheduled risk intercept for ${user.phone} at ${riskTime}`);
  }

  scheduledJobs.set(user.id, jobs);
}

export function cancelUserJobs(userId: string): void {
  const jobs = scheduledJobs.get(userId);
  if (jobs) {
    for (const job of jobs) {
      job.task.stop();
    }
    scheduledJobs.delete(userId);
  }
}

async function sendMorningMessage(user: User): Promise<void> {
  try {
    const contract = await getActiveContract(user.id);
    if (!contract) return;

    const context = await buildContext(user, contract);
    const message = await generateMorningMessage(user, contract, context);

    await sendMessage(user.phone, message);
    console.log(`Morning message sent to ${user.phone}`);
  } catch (error) {
    console.error(`Error sending morning message to ${user.phone}:`, error);
  }
}

async function sendNightlyReminder(user: User): Promise<void> {
  try {
    await sendMessage(user.phone, `Time to lock tomorrow.

Reply "lock" to start your nightly check-in.`);
    console.log(`Nightly reminder sent to ${user.phone}`);
  } catch (error) {
    console.error(`Error sending nightly reminder to ${user.phone}:`, error);
  }
}

async function sendRiskIntercept(user: User, riskTime: string): Promise<void> {
  try {
    const message = `It's ${riskTime}. This is your danger zone.

Are you still on track? What's the next right action?`;

    await sendMessage(user.phone, message);
    console.log(`Risk intercept sent to ${user.phone} at ${riskTime}`);
  } catch (error) {
    console.error(`Error sending risk intercept to ${user.phone}:`, error);
  }
}

async function buildContext(user: User, contract: Contract): Promise<ConversationContext> {
  const [recentLogs, patterns, memory] = await Promise.all([
    getRecentLogs(user.id, 7),
    getUserPatterns(user.id, 10),
    buildMemoryContext(user),
  ]);

  return {
    user,
    contract,
    recentLogs,
    patterns,
    recentMessages: memory.recentMessages,
    currentFlow: 'morning',
  };
}

function parseTime(timeStr: string): [number, number] {
  const cleaned = timeStr.replace(/\s+/g, '').toLowerCase();

  // Handle HH:MM format
  const [hoursStr, minutesStr = '0'] = cleaned.replace(/am|pm/g, '').split(':');
  let hours = parseInt(hoursStr, 10);
  const minutes = parseInt(minutesStr, 10);

  // Handle AM/PM
  if (cleaned.includes('pm') && hours < 12) hours += 12;
  if (cleaned.includes('am') && hours === 12) hours = 0;

  return [hours, minutes];
}

export function getScheduledJobs(): Map<string, ScheduledJob[]> {
  return scheduledJobs;
}
