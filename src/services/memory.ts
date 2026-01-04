import {
  User,
  Pattern,
  Message,
  getUserPatterns,
  getRecentMessages,
  recordPattern,
  saveMessage,
} from '../db/queries';

export interface MemoryContext {
  patterns: Pattern[];
  recentMessages: Message[];
  verbatimExcuses: string[];
  failureTimes: string[];
  repeatTriggers: string[];
}

export async function buildMemoryContext(user: User): Promise<MemoryContext> {
  const [patterns, messages] = await Promise.all([
    getUserPatterns(user.id, 20),
    getRecentMessages(user.id, 30),
  ]);

  // Extract specific pattern types
  const verbatimExcuses = patterns
    .filter(p => p.pattern_type === 'miss_reason')
    .map(p => p.content);

  const failureTimes = patterns
    .filter(p => p.pattern_type === 'failure_time')
    .map(p => p.content);

  const repeatTriggers = patterns
    .filter(p => p.pattern_type === 'trigger' && p.frequency >= 2)
    .map(p => p.content);

  return {
    patterns,
    recentMessages: messages,
    verbatimExcuses,
    failureTimes,
    repeatTriggers,
  };
}

export async function extractAndSavePatterns(
  user: User,
  message: string,
  context: 'miss_reason' | 'trigger' | 'excuse' | 'success'
): Promise<void> {
  // Record the pattern
  await recordPattern(user.id, context, message);

  // Extract time mentions
  const timeMatch = message.match(/(\d{1,2}[:\s]?\d{0,2}\s*(?:am|pm)?)/gi);
  if (timeMatch) {
    for (const time of timeMatch) {
      await recordPattern(user.id, 'time_mention', time);
    }
  }

  // Extract emotion words
  const emotionWords = [
    'tired', 'stressed', 'anxious', 'bored', 'hungry',
    'frustrated', 'angry', 'sad', 'happy', 'motivated',
    'lazy', 'busy', 'overwhelmed',
  ];

  for (const word of emotionWords) {
    if (message.toLowerCase().includes(word)) {
      await recordPattern(user.id, 'emotion', word);
    }
  }
}

export function generatePatternCallout(
  memory: MemoryContext
): string | null {
  // Find the most frequent recent pattern
  const topPattern = memory.patterns
    .filter(p => p.pattern_type === 'miss_reason')
    .sort((a, b) => b.frequency - a.frequency)[0];

  if (!topPattern || topPattern.frequency < 2) {
    return null;
  }

  return `I've noticed this ${topPattern.frequency} times: "${topPattern.content}"`;
}

export function findSimilarExcuse(
  currentMessage: string,
  memory: MemoryContext
): Pattern | null {
  const currentWords = currentMessage.toLowerCase().split(/\s+/);

  for (const excuse of memory.patterns.filter(p => p.pattern_type === 'miss_reason')) {
    const excuseWords = excuse.content.toLowerCase().split(/\s+/);
    const overlap = currentWords.filter(w => excuseWords.includes(w));

    if (overlap.length >= 2) {
      return excuse;
    }
  }

  return null;
}

export async function recordConversation(
  user: User,
  role: 'user' | 'assistant',
  content: string,
  flow: string
): Promise<void> {
  await saveMessage(user.id, role, content, flow);
}

export function getUserPastWords(memory: MemoryContext): string[] {
  // Extract notable phrases from past messages
  const userMessages = memory.recentMessages
    .filter(m => m.role === 'user')
    .map(m => m.content);

  const phrases: string[] = [];

  for (const msg of userMessages) {
    // Extract quoted-worthy phrases (excuses, commitments)
    if (msg.length > 10 && msg.length < 100) {
      phrases.push(msg);
    }
  }

  return phrases.slice(0, 5);
}

export function detectRationalization(message: string): boolean {
  const patterns = [
    /just\s+(this\s+)?once/i,
    /i deserve/i,
    /i earned/i,
    /special occasion/i,
    /won'?t matter/i,
    /start fresh/i,
    /tomorrow i'?ll/i,
    /one (more|little|small)/i,
    /it'?s (fine|ok|okay)/i,
    /doesn'?t count/i,
    /cheat (day|meal)/i,
  ];

  return patterns.some(p => p.test(message));
}

export function generateRationalizationResponse(
  message: string,
  memory: MemoryContext
): string {
  const similarExcuse = findSimilarExcuse(message, memory);

  if (similarExcuse) {
    return `You said something similar ${similarExcuse.frequency} times before: "${similarExcuse.content}"

How did that work out?`;
  }

  return `That sounds like rationalization. Let me be clear:

You already decided what you're doing. That decision was made when you were thinking clearly.

This is the moment that matters. What's the next right action?`;
}
