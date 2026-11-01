// Detects and redacts attempts to share direct contact details in chat, so MyCity stays the channel.
const patterns: RegExp[] = [
  /(?:\+?91[\s-]*)?(?:\d[\s-]*){10}/g,                  // Indian mobile numbers, with spaces/dashes
  /[A-Z0-9._%+-]+\s*(?:@|\[at\]|\(at\))\s*[A-Z0-9.-]+\.[A-Z]{2,}/gi, // emails
  /\b(?:https?:\/\/|www\.)\S+/gi,                       // links
  /\bwa\.me\/\S+/gi,                                    // WhatsApp links
];
const words = /\b(whats\s*app|watsapp|telegram|call me on|my number)\b/gi;

export function guardContact(text: string): { text: string; redacted: boolean } {
  let out = text;
  for (const p of patterns) out = out.replace(p, '[hidden by MyCity]');
  out = out.replace(words, '[hidden by MyCity]');
  return { text: out, redacted: out !== text };
}
