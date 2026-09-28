import test from "node:test";
import assert from "node:assert/strict";
import { base64, buildMessage, emailProblem, pickEmails, takeReply } from "../worker/mail.js";
import { sendMail } from "../worker/smtp.js";

const decode = (text) => Buffer.from(text, "base64").toString("utf8");

// Reads a subject back the way a mail program would.
function subjectOf(head) {
  const raw = /\r\nSubject: ((?:.+)(?:\r\n .+)*)/.exec(head)[1];
  return raw
    .split("\r\n ")
    .map((word) => (word.startsWith("=?UTF-8?B?") ? decode(word.slice(10, -2)) : word))
    .join("");
}

test("ordinary addresses are accepted", () => {
  assert.equal(emailProblem("paltsi@example.com"), null);
  assert.equal(emailProblem("first.last+cup@mail.example.fi"), null);
});

test("broken or dangerous addresses are refused", () => {
  for (const bad of [undefined, "", "nobody", "a@b", "a b@example.com", "a@example.com\r\nRCPT TO:<x@y.z>", "<a@example.com>", "a@example.com>", `${"a".repeat(250)}@example.com`]) {
    assert.notEqual(emailProblem(bad), null, String(bad));
  }
});

test("a message has encoded headers and a base64 body", () => {
  const message = buildMessage({
    from: "league@example.com",
    fromName: "Ydin liitto Cup",
    subject: "Pick 3: Läpä picked Montréal Canadiens",
    text: "Läpä picked.\n.\nA line with only a dot above.",
    date: new Date("2026-09-29T10:00:00Z"),
    id: "fixed",
  });
  const [head, body] = message.split("\r\n\r\n");
  assert.match(head, /^From: Ydin liitto Cup <league@example.com>\r\n/);
  assert.match(head, /\r\nTo: undisclosed-recipients:;\r\n/);
  assert.match(head, /\r\nDate: Tue, 29 Sep 2026 10:00:00 \+0000\r\n/);
  assert.match(head, /\r\nMessage-ID: <fixed@example.com>\r\n/);
  assert.equal(subjectOf(head), "Pick 3: Läpä picked Montréal Canadiens");
  assert.equal(decode(body.replaceAll("\r\n", "")), "Läpä picked.\r\n.\r\nA line with only a dot above.");
  for (const line of message.split("\r\n")) {
    assert.ok(line.length <= 78, "lines stay short");
    assert.notEqual(line, ".", "no line can end the message early");
  }
});

test("a long subject is folded over several short lines", () => {
  const subject = "Your turn to pick: Herra Tossavainen picked Montréal Canadiens ääkköset";
  const message = buildMessage({ from: "league@example.com", fromName: "Cup", subject, text: "x" });
  assert.equal(subjectOf(message.split("\r\n\r\n")[0]), subject);
  for (const line of message.split("\r\n")) assert.ok(line.length <= 78, line);
});

test("server replies are read one at a time, including multi-line ones", () => {
  assert.equal(takeReply("250-smtp.example.com\r\n250-AUTH PL"), null);
  const reply = takeReply("250-smtp.example.com\r\n250-SIZE 100\r\n250 AUTH PLAIN\r\n354 go\r\n");
  assert.equal(reply.code, 250);
  assert.equal(reply.rest, "354 go\r\n");
  assert.equal(takeReply("220\r\n").code, 220);
});

const base = {
  pick: { pickNumber: 3, round: 1 },
  picker: "R",
  teamName: "Edmonton Oilers",
  next: "Läpä",
  totalPicks: 28,
  url: "https://cup.example",
};

test("everyone subscribed hears about a pick, except the picker", () => {
  const emails = pickEmails({
    ...base,
    subscriptions: { R: "r@example.com", Paltsi: "p@example.com", AV: "av@example.com" },
  });
  assert.equal(emails.length, 1);
  assert.deepEqual(emails[0].to, ["p@example.com", "av@example.com"]);
  assert.equal(emails[0].subject, "Pick 3: R picked Edmonton Oilers");
  assert.match(emails[0].text, /Round 1, pick 3 of 28\./);
  assert.match(emails[0].text, /Next on the clock: Läpä\./);
  assert.match(emails[0].text, /https:\/\/cup\.example/);
});

test("the next player gets a message of their own", () => {
  const emails = pickEmails({ ...base, subscriptions: { Läpä: "l@example.com", AV: "av@example.com" } });
  assert.deepEqual(emails.map((email) => [email.to, email.subject]), [
    [["l@example.com"], "Your turn to pick: R picked Edmonton Oilers"],
    [["av@example.com"], "Pick 3: R picked Edmonton Oilers"],
  ]);
});

test("picking twice in a row at the turn of the snake sends no reminder to oneself", () => {
  const emails = pickEmails({ ...base, next: "R", subscriptions: { R: "r@example.com" } });
  assert.deepEqual(emails, []);
});

test("the last pick announces the end of the draft", () => {
  const emails = pickEmails({ ...base, next: null, subscriptions: { AV: "av@example.com" } });
  assert.equal(emails[0].subject, "Draft complete: R picked Edmonton Oilers");
  assert.match(emails[0].text, /The draft is complete\./);
});

test("nobody subscribed means no email", () => {
  assert.deepEqual(pickEmails({ ...base, subscriptions: {} }), []);
});

// A scripted mail server: answers each command the way Gmail would.
function fakeServer({ refuseLogin = false } = {}) {
  const received = [];
  let respond;
  const readable = new ReadableStream({ start: (controller) => (respond = (text) => controller.enqueue(new TextEncoder().encode(text))) });
  let inData = false;
  let pending = "";
  const writable = new WritableStream({
    write(chunk) {
      pending += new TextDecoder().decode(chunk);
      for (;;) {
        const end = inData ? pending.indexOf("\r\n.\r\n") : pending.indexOf("\r\n");
        if (end < 0) return;
        const line = pending.slice(0, end);
        pending = pending.slice(end + (inData ? 5 : 2));
        received.push(line);
        if (inData) {
          inData = false;
          respond("250 2.0.0 OK\r\n");
        } else if (line.startsWith("EHLO")) respond("250-smtp.example.com at your service\r\n250-SIZE 35882577\r\n250 AUTH LOGIN PLAIN\r\n");
        else if (line.startsWith("AUTH")) respond(refuseLogin ? "535-5.7.8 Username and Password not accepted.\r\n535 5.7.8 Learn more\r\n" : "235 2.7.0 Accepted\r\n");
        else if (line === "DATA") {
          inData = true;
          respond("354 Go ahead\r\n");
        } else if (line === "QUIT") respond("221 2.0.0 closing connection\r\n");
        else respond("250 2.1.0 OK\r\n");
      }
    },
  });
  const calls = [];
  const connect = (address, options) => {
    calls.push({ address, options });
    queueMicrotask(() => respond("220 smtp.example.com ESMTP\r\n"));
    return { readable, writable, close: async () => calls.push("closed") };
  };
  return { connect, received, calls };
}

const account = { host: "smtp.example.com", port: 465, user: "league@example.com", password: "app password", fromName: "Ydin liitto Cup" };

test("the client logs in and delivers every message", async () => {
  const server = fakeServer();
  await sendMail({
    connect: server.connect,
    ...account,
    emails: [
      { to: ["l@example.com"], subject: "Your turn", text: "Go" },
      { to: ["p@example.com", "av@example.com"], subject: "Pick 3", text: "Hello" },
    ],
  });
  assert.deepEqual(server.calls[0], { address: { hostname: "smtp.example.com", port: 465 }, options: { secureTransport: "on" } });
  assert.equal(server.calls.at(-1), "closed");

  const commands = server.received.map((line) => line.split("\r\n")[0]);
  assert.deepEqual(commands.map((line) => line.split(/[ :]/)[0]), [
    "EHLO", "AUTH", "MAIL", "RCPT", "DATA", "From", "MAIL", "RCPT", "RCPT", "DATA", "From", "QUIT",
  ]);
  assert.equal(commands[1], `AUTH PLAIN ${base64("\0league@example.com\0app password")}`);
  assert.equal(commands[2], "MAIL FROM:<league@example.com>");
  assert.equal(commands[3], "RCPT TO:<l@example.com>");

  const [single, shared] = server.received.filter((line) => line.startsWith("From:"));
  assert.match(single, /\r\nTo: l@example\.com\r\n/);
  assert.match(shared, /\r\nTo: undisclosed-recipients:;\r\n/);
  assert.doesNotMatch(shared, /p@example\.com|av@example\.com/, "recipients are hidden from each other");
});

test("a refused login is reported and the connection is closed", async () => {
  const server = fakeServer({ refuseLogin: true });
  await assert.rejects(
    sendMail({ connect: server.connect, ...account, emails: [{ to: ["l@example.com"], subject: "s", text: "t" }] }),
    /the login was refused: 535-5\.7\.8 Username and Password not accepted/,
  );
  assert.equal(server.calls.at(-1), "closed");
  assert.ok(!server.received.some((line) => line.startsWith("MAIL")), "nothing is sent after a failed login");
});
