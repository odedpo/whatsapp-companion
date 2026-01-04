import OpenAI from 'openai';
import { config } from '../config/env';
import { getSystemPrompt, getContextPrompt } from '../prompts/system';
import { User, Contract, DailyLog, Pattern, Message } from '../db/queries';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

export interface ConversationContext {
  user: User;
  contract: Contract | null;
  recentLogs: DailyLog[];
  patterns: Pattern[];
  recentMessages: Message[];
  currentFlow: string;
  additionalContext?: string;
}

export async function generateResponse(
  userMessage: string,
  context: ConversationContext
): Promise<string> {
  const systemPrompt = getSystemPrompt();
  const contextPrompt = getContextPrompt(context);

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'system', content: contextPrompt },
  ];

  // Add recent conversation history
  const recentMessages = context.recentMessages.slice(0, 10).reverse();
  for (const msg of recentMessages) {
    messages.push({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    });
  }

  // Add current message
  messages.push({ role: 'user', content: userMessage });

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      max_tokens: 500,
      temperature: 0.7,
    });

    return response.choices[0]?.message?.content || 'I couldn\'t generate a response.';
  } catch (error) {
    console.error('Error generating LLM response:', error);
    throw error;
  }
}

export async function generateFlowResponse(
  context: ConversationContext,
  flowPrompt: string
): Promise<string> {
  const systemPrompt = getSystemPrompt();
  const contextPrompt = getContextPrompt(context);

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'system', content: contextPrompt },
    { role: 'user', content: flowPrompt },
  ];

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      max_tokens: 500,
      temperature: 0.7,
    });

    return response.choices[0]?.message?.content || 'I couldn\'t generate a response.';
  } catch (error) {
    console.error('Error generating flow response:', error);
    throw error;
  }
}

export async function classifyIntent(message: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `Classify the user's message into one of these intents:
- LOG_SCORE: User is reporting completion of an action (e.g., "did my walk", "hit protein", "2000 calories")
- BAD_DAY: User is declaring a bad/hard day
- QUESTION: User is asking a question
- LOCK_TOMORROW: User wants to lock tomorrow's plan
- CHECK_STATUS: User wants to know their status/score
- GENERAL: General conversation
- SKIP: User wants to skip/postpone something
- PHOTO: User is sending or referencing a photo

Respond with ONLY the intent label.`,
      },
      { role: 'user', content: message },
    ],
    max_tokens: 20,
    temperature: 0,
  });

  return response.choices[0]?.message?.content?.trim() || 'GENERAL';
}
