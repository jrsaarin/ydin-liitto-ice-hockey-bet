// Pure helpers for email: address checks, message formatting and the wording
// of pick notifications. No I/O, so everything here is unit tested.

const MAX_EMAIL_LENGTH = 254;
// Deliberately strict. Whitespace and angle brackets are refused, which also
// rules out smuggling extra SMTP commands or headers through an address.
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

// Returns an error message, or null when the address is usable.
export function emailProblem(email) {
  if (typeof email !== "string" || email.length === 0) return "The email address is missing.";
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL.test(email)) return "That does not look like an email address.";
  return null;
}

export function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// Header text outside plain ASCII, such as "Läpä", has to be encoded. Long
// text is cut into several encoded words on separate lines, without ever
// cutting a character in half.
function headerText(text) {
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  const encoder = new TextEncoder();
  const words = [];
  let chunk = "";
  let size = 0;
  for (const character of text) {
    const length = encoder.encode(character).length;
    if (size + length > 42) {
      words.push(chunk);
      chunk = "";
      size = 0;
    }
    chunk += character;
    size += length;
  }
  words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${base64(word)}?=`).join("\r\n ");
}

// Builds one complete message. The body travels as base64, which keeps every
// line short and makes a lone "." line, the SMTP end marker, impossible.
export function buildMessage({ from, fromName, to, subject, text, date = new Date(), id }) {
  const domain = from.split("@")[1];
  const body = base64(text.replace(/\r?\n/g, "\r\n")).match(/.{1,76}/g) ?? [];
  return [
    `From: ${headerText(fromName)} <${from}>`,
    `To: ${to ?? "undisclosed-recipients:;"}`,
    `Subject: ${headerText(subject)}`,
    `Date: ${date.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${id ?? crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    ...body,
  ].join("\r\n");
}

// Takes one complete server reply off the front of the buffer. A reply can
// span several lines: "250-..." continues and "250 ..." is the last line.
// Returns null while the reply is still incomplete.
export function takeReply(buffer) {
  const match = /^(?:\d{3}-[^\r\n]*\r\n)*(\d{3})(?: [^\r\n]*)?\r\n/.exec(buffer);
  if (!match) return null;
  return { code: Number(match[1]), text: match[0].trimEnd(), rest: buffer.slice(match[0].length) };
}

// The emails for one pick. Everyone subscribed hears about it, except the
// player who made it. The player who is up next gets a message of their own.
// `subscriptions` maps player names to addresses.
export function pickEmails({ pick, picker, teamName, next, totalPicks, subscriptions, url }) {
  const done = next == null;
  const headline = `${picker} picked ${teamName}`;
  const lines = [
    `${headline}.`,
    `Round ${pick.round}, pick ${pick.pickNumber} of ${totalPicks}.`,
    "",
    done ? "That was the last pick. The draft is complete." : `Next on the clock: ${next}.`,
    "",
    url,
    "",
    "You get this because you subscribed on the draft page. You can unsubscribe there.",
  ];
  const text = lines.join("\n");

  const emails = [];
  const nextAddress = done ? null : subscriptions[next];
  if (nextAddress && next !== picker) {
    emails.push({ to: [nextAddress], subject: `Your turn to pick: ${headline}`, text });
  }
  const others = Object.entries(subscriptions)
    .filter(([name]) => name !== picker && name !== next)
    .map(([, address]) => address);
  if (others.length > 0) {
    emails.push({ to: others, subject: done ? `Draft complete: ${headline}` : `Pick ${pick.pickNumber}: ${headline}`, text });
  }
  return emails;
}
