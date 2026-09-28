// A minimal SMTP client: log in, hand over messages, leave. It speaks to the
// server over a socket from `connect`, which is passed in so that tests can
// use a fake one. In the Worker it comes from "cloudflare:sockets".

import { base64, buildMessage, takeReply } from "./mail.js";

const TIMEOUT_MS = 15_000;

class SmtpError extends Error {}

async function converse(socket, { user, password, fromName, emails }) {
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  async function expect(code, step) {
    for (;;) {
      const reply = takeReply(buffer);
      if (reply) {
        buffer = reply.rest;
        if (reply.code !== code) throw new SmtpError(`${step} was refused: ${reply.text}`);
        return reply;
      }
      const { value, done } = await reader.read();
      if (done) throw new SmtpError(`The mail server hung up during ${step}.`);
      buffer += decoder.decode(value, { stream: true });
    }
  }

  async function send(line, code, step) {
    await writer.write(encoder.encode(`${line}\r\n`));
    return expect(code, step);
  }

  await expect(220, "the greeting");
  await send("EHLO cup.local", 250, "the hello");
  await send(`AUTH PLAIN ${base64(`\0${user}\0${password}`)}`, 235, "the login");
  for (const email of emails) {
    await send(`MAIL FROM:<${user}>`, 250, "the sender");
    for (const address of email.to) await send(`RCPT TO:<${address}>`, 250, "a recipient");
    await send("DATA", 354, "the message start");
    // Several recipients are hidden from each other. A single one is addressed by name.
    const to = email.to.length === 1 ? email.to[0] : undefined;
    const message = buildMessage({ from: user, fromName, to, subject: email.subject, text: email.text });
    await send(`${message}\r\n.`, 250, "the message");
  }
  await send("QUIT", 221, "the goodbye");
}

export async function sendMail({ connect, host, port, secure = true, ...conversation }) {
  const socket = connect({ hostname: host, port }, { secureTransport: secure ? "on" : "off" });
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new SmtpError("The mail server took too long.")), TIMEOUT_MS);
  });
  try {
    await Promise.race([converse(socket, conversation), timeout]);
  } finally {
    clearTimeout(timer);
    await socket.close().catch(() => {});
  }
}
