import { Router, Request, Response } from 'express';
import { parseIncomingMessage, sendMessage } from '../services/twilio';
import { generateResponse, classifyIntent, ConversationContext } from '../services/llm';
import {
  getOrCreateUser,
  getActiveContract,
  getRecentLogs,
  getUserPatterns,
  User,
  Contract,
} from '../db/queries';
import { handleOnboarding, isOnboarding } from '../flows/onboarding';
import { handleNightlyLock, isInNightlyLock, resetNightlyLock } from '../flows/nightlyLock';
import { updateScore, getCurrentScore, parseScoreUpdate, getWeeklyReport } from '../flows/scorecard';
import { handleBadDay, detectBadDayRequest } from '../flows/badDay';
import { handlePhotoMessage } from '../flows/photoShame';
import { getTokenStatus, generateTokenStatusMessage } from '../flows/lossAversion';
import { buildMemoryContext, recordConversation, detectRationalization, generateRationalizationResponse } from '../services/memory';
import { scheduleUserJobs } from '../services/scheduler';

const router = Router();

router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const incoming = parseIncomingMessage(req.body);
    console.log(`Received message from ${incoming.from}: ${incoming.body}`);

    // Get or create user
    const user = await getOrCreateUser(incoming.from);

    // Handle the message
    const response = await handleMessage(user, incoming.body, incoming.mediaUrl);

    // Send response
    if (response) {
      await sendMessage(user.phone, response);

      // Record the conversation
      await recordConversation(user, 'user', incoming.body, getCurrentFlow(user));
      await recordConversation(user, 'assistant', response, getCurrentFlow(user));
    }

    // Respond to Twilio
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Error processing message');
  }
});

async function handleMessage(
  user: User,
  message: string,
  mediaUrl?: string
): Promise<string> {
  // Handle photo uploads
  if (mediaUrl) {
    return await handlePhotoMessage(user, mediaUrl);
  }

  // Handle onboarding
  if (isOnboarding(user)) {
    const response = await handleOnboarding(user, message);

    // If onboarding just completed, schedule jobs
    if (response.includes('Contract locked')) {
      await scheduleUserJobs(user);
    }

    return response;
  }

  const contract = await getActiveContract(user.id);
  if (!contract) {
    return "You don't have an active contract. Send 'start' to begin onboarding.";
  }

  // Build context for all handlers
  const context = await buildContext(user, contract);

  // Handle nightly lock flow
  if (isInNightlyLock(user.id)) {
    return await handleNightlyLock(user, contract, message, context);
  }

  // Check for specific commands/intents
  const lower = message.toLowerCase().trim();

  // Start nightly lock
  if (lower === 'lock' || lower === 'nightly' || lower.includes('lock tomorrow')) {
    return await handleNightlyLock(user, contract, message, context);
  }

  // Check status
  if (lower === 'status' || lower === 'score' || lower.includes('how am i')) {
    return await getCurrentScore(user, contract);
  }

  // Weekly report
  if (lower === 'week' || lower === 'weekly' || lower.includes('weekly report')) {
    return await getWeeklyReport(user, contract);
  }

  // Token status
  if (lower === 'tokens' || lower.includes('token')) {
    const status = await getTokenStatus(user);
    return generateTokenStatusMessage(status);
  }

  // Bad day protocol
  if (detectBadDayRequest(message)) {
    return await handleBadDay(user, contract, message);
  }

  // Reset command (for testing)
  if (lower === 'reset') {
    resetNightlyLock(user.id);
    return 'State reset. What do you need?';
  }

  // Check for rationalization
  if (detectRationalization(message)) {
    const memory = await buildMemoryContext(user);
    return generateRationalizationResponse(message, memory);
  }

  // Try to parse as score update
  const scoreUpdate = parseScoreUpdate(message, contract);
  if (scoreUpdate) {
    const result = await updateScore(user, contract, scoreUpdate);
    return result.message;
  }

  // Classify intent and respond accordingly
  const intent = await classifyIntent(message);

  switch (intent) {
    case 'LOG_SCORE':
      return "I couldn't parse that as a score. Which action did you complete? (e.g., 'did calories', '150g protein', '12k steps')";

    case 'BAD_DAY':
      return await handleBadDay(user, contract, message);

    case 'LOCK_TOMORROW':
      return await handleNightlyLock(user, contract, message, context);

    case 'CHECK_STATUS':
      return await getCurrentScore(user, contract);

    case 'SKIP':
      return "There's no skip button. There's only 'do it' or 'don't do it and own the consequence.'";

    default:
      // General conversation - use LLM
      return await generateResponse(message, context);
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
    currentFlow: getCurrentFlow(user),
  };
}

function getCurrentFlow(user: User): string {
  if (isOnboarding(user)) return 'onboarding';
  if (isInNightlyLock(user.id)) return 'nightly_lock';
  return 'general';
}

export default router;
