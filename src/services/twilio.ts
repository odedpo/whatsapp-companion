import twilio from 'twilio';
import { config } from '../config/env';

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

export interface IncomingMessage {
  from: string;
  body: string;
  mediaUrl?: string;
  mediaContentType?: string;
}

export async function sendMessage(to: string, body: string): Promise<void> {
  try {
    await client.messages.create({
      from: config.twilio.phoneNumber,
      to: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
      body,
    });
    console.log(`Message sent to ${to}: ${body.substring(0, 50)}...`);
  } catch (error) {
    console.error('Error sending message:', error);
    throw error;
  }
}

export async function sendMediaMessage(
  to: string,
  body: string,
  mediaUrl: string
): Promise<void> {
  try {
    await client.messages.create({
      from: config.twilio.phoneNumber,
      to: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
      body,
      mediaUrl: [mediaUrl],
    });
    console.log(`Media message sent to ${to}`);
  } catch (error) {
    console.error('Error sending media message:', error);
    throw error;
  }
}

export function parseIncomingMessage(body: any): IncomingMessage {
  return {
    from: body.From,
    body: body.Body || '',
    mediaUrl: body.MediaUrl0,
    mediaContentType: body.MediaContentType0,
  };
}

export function validateTwilioSignature(
  signature: string,
  url: string,
  params: Record<string, string>
): boolean {
  return twilio.validateRequest(
    config.twilio.authToken,
    signature,
    url,
    params
  );
}
