import { query, queryOne } from './client';

// User types
export interface User {
  id: string;
  phone: string;
  name: string | null;
  timezone: string;
  wake_time: string | null;
  sleep_time: string | null;
  eating_window_start: string | null;
  eating_window_end: string | null;
  risk_times: string[];
  shame_level: number;
  loss_aversion_enabled: boolean;
  onboarding_complete: boolean;
  onboarding_step: string;
  created_at: Date;
}

export interface Contract {
  id: string;
  user_id: string;
  goal: string;
  binary_actions: BinaryAction[];
  rules_text: string | null;
  locked_at: Date;
  expires_at: Date | null;
  active: boolean;
}

export interface BinaryAction {
  name: string;
  threshold?: string;
  points: number;
}

export interface DailyLog {
  id: string;
  user_id: string;
  date: string;
  scores: Record<string, number>;
  total_score: number;
  tomorrow_locked: boolean;
  tomorrow_plan: TomorrowPlan | null;
  miss_reason: string | null;
  notes: string | null;
  created_at: Date;
}

export interface TomorrowPlan {
  eating_window: string;
  first_meal: string;
  walk_time: string;
  strength: boolean;
  danger_moment: string;
}

export interface TokenRecord {
  id: string;
  user_id: string;
  week_start: string;
  starting_tokens: number;
  current_tokens: number;
  loss_events: LossEvent[];
  punishment_triggered: boolean;
}

export interface LossEvent {
  date: string;
  reason: string;
  amount: number;
}

export interface Pattern {
  id: string;
  user_id: string;
  pattern_type: string;
  content: string;
  frequency: number;
  last_seen: Date;
}

export interface Message {
  id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  flow: string;
  created_at: Date;
}

// User queries
export async function findUserByPhone(phone: string): Promise<User | null> {
  return queryOne<User>('SELECT * FROM users WHERE phone = $1', [phone]);
}

export async function createUser(phone: string): Promise<User> {
  const rows = await query<User>(
    'INSERT INTO users (phone) VALUES ($1) RETURNING *',
    [phone]
  );
  return rows[0];
}

export async function updateUser(id: string, updates: Partial<User>): Promise<User | null> {
  const fields = Object.keys(updates);
  const values = Object.values(updates);
  const setClause = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');

  return queryOne<User>(
    `UPDATE users SET ${setClause} WHERE id = $1 RETURNING *`,
    [id, ...values]
  );
}

export async function getOrCreateUser(phone: string): Promise<User> {
  let user = await findUserByPhone(phone);
  if (!user) {
    user = await createUser(phone);
  }
  return user;
}

// Contract queries
export async function getActiveContract(userId: string): Promise<Contract | null> {
  return queryOne<Contract>(
    'SELECT * FROM contracts WHERE user_id = $1 AND active = true ORDER BY locked_at DESC LIMIT 1',
    [userId]
  );
}

export async function createContract(
  userId: string,
  goal: string,
  binaryActions: BinaryAction[],
  rulesText: string
): Promise<Contract> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 1 week

  const rows = await query<Contract>(
    `INSERT INTO contracts (user_id, goal, binary_actions, rules_text, expires_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [userId, goal, JSON.stringify(binaryActions), rulesText, expiresAt]
  );
  return rows[0];
}

// Daily log queries
export async function getTodayLog(userId: string): Promise<DailyLog | null> {
  return queryOne<DailyLog>(
    `SELECT * FROM daily_logs WHERE user_id = $1 AND date = CURRENT_DATE`,
    [userId]
  );
}

export async function getYesterdayLog(userId: string): Promise<DailyLog | null> {
  return queryOne<DailyLog>(
    `SELECT * FROM daily_logs WHERE user_id = $1 AND date = CURRENT_DATE - 1`,
    [userId]
  );
}

export async function upsertDailyLog(
  userId: string,
  date: string,
  updates: Partial<DailyLog>
): Promise<DailyLog> {
  const existing = await queryOne<DailyLog>(
    'SELECT * FROM daily_logs WHERE user_id = $1 AND date = $2',
    [userId, date]
  );

  if (existing) {
    const fields = Object.keys(updates);
    const values = Object.values(updates).map(v =>
      typeof v === 'object' ? JSON.stringify(v) : v
    );
    const setClause = fields.map((f, i) => `${f} = $${i + 3}`).join(', ');

    const result = await queryOne<DailyLog>(
      `UPDATE daily_logs SET ${setClause} WHERE user_id = $1 AND date = $2 RETURNING *`,
      [userId, date, ...values]
    );
    return result!;
  }

  const fields = ['user_id', 'date', ...Object.keys(updates)];
  const values = [userId, date, ...Object.values(updates).map(v =>
    typeof v === 'object' ? JSON.stringify(v) : v
  )];
  const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');

  const rows = await query<DailyLog>(
    `INSERT INTO daily_logs (${fields.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    values
  );
  return rows[0];
}

export async function getRecentLogs(userId: string, days: number = 7): Promise<DailyLog[]> {
  return query<DailyLog>(
    `SELECT * FROM daily_logs WHERE user_id = $1 AND date >= CURRENT_DATE - INTERVAL '1 day' * $2 ORDER BY date DESC`,
    [userId, days]
  );
}

// Token queries
export async function getCurrentWeekTokens(userId: string): Promise<TokenRecord | null> {
  return queryOne<TokenRecord>(
    `SELECT * FROM tokens WHERE user_id = $1 AND week_start = date_trunc('week', CURRENT_DATE)::date`,
    [userId]
  );
}

export async function getOrCreateWeekTokens(userId: string): Promise<TokenRecord> {
  let tokens = await getCurrentWeekTokens(userId);
  if (!tokens) {
    const rows = await query<TokenRecord>(
      `INSERT INTO tokens (user_id, week_start) VALUES ($1, date_trunc('week', CURRENT_DATE)::date) RETURNING *`,
      [userId]
    );
    tokens = rows[0];
  }
  return tokens;
}

export async function deductToken(
  userId: string,
  reason: string,
  amount: number = 1
): Promise<TokenRecord> {
  const tokens = await getOrCreateWeekTokens(userId);
  const newAmount = Math.max(0, tokens.current_tokens - amount);
  const lossEvent: LossEvent = {
    date: new Date().toISOString().split('T')[0],
    reason,
    amount,
  };
  const lossEvents = [...tokens.loss_events, lossEvent];

  const result = await queryOne<TokenRecord>(
    `UPDATE tokens SET current_tokens = $2, loss_events = $3, punishment_triggered = $4
     WHERE id = $1 RETURNING *`,
    [tokens.id, newAmount, JSON.stringify(lossEvents), newAmount === 0]
  );
  return result!;
}

// Pattern queries
export async function recordPattern(
  userId: string,
  patternType: string,
  content: string
): Promise<Pattern> {
  const existing = await queryOne<Pattern>(
    'SELECT * FROM patterns WHERE user_id = $1 AND pattern_type = $2 AND content = $3',
    [userId, patternType, content]
  );

  if (existing) {
    const result = await queryOne<Pattern>(
      'UPDATE patterns SET frequency = frequency + 1, last_seen = NOW() WHERE id = $1 RETURNING *',
      [existing.id]
    );
    return result!;
  }

  const rows = await query<Pattern>(
    'INSERT INTO patterns (user_id, pattern_type, content) VALUES ($1, $2, $3) RETURNING *',
    [userId, patternType, content]
  );
  return rows[0];
}

export async function getUserPatterns(userId: string, limit: number = 10): Promise<Pattern[]> {
  return query<Pattern>(
    'SELECT * FROM patterns WHERE user_id = $1 ORDER BY frequency DESC, last_seen DESC LIMIT $2',
    [userId, limit]
  );
}

// Message queries
export async function saveMessage(
  userId: string,
  role: 'user' | 'assistant',
  content: string,
  flow: string
): Promise<Message> {
  const rows = await query<Message>(
    'INSERT INTO messages (user_id, role, content, flow) VALUES ($1, $2, $3, $4) RETURNING *',
    [userId, role, content, flow]
  );
  return rows[0];
}

export async function getRecentMessages(
  userId: string,
  limit: number = 20
): Promise<Message[]> {
  return query<Message>(
    'SELECT * FROM messages WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, limit]
  );
}

export async function getFlowMessages(
  userId: string,
  flow: string,
  limit: number = 10
): Promise<Message[]> {
  return query<Message>(
    'SELECT * FROM messages WHERE user_id = $1 AND flow = $2 ORDER BY created_at DESC LIMIT $3',
    [userId, flow, limit]
  );
}
