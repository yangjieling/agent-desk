/**
 * Smoke: Feishu IM inbound challenge + signature + message parse (no HTTP server).
 * Run after build: node scripts/smoke-im-webhook.mjs
 */
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Import compiled server helpers via relative path (package not exported).
const webhook = await import(path.join(root, "packages/server/dist/im-webhook.js"));

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

const encryptKey = "test-encrypt-key";
const verificationToken = "vt_test";

// Challenge
{
  const event = {
    challenge: "chal-123",
    token: verificationToken,
    type: "url_verification",
  };
  const parsed = webhook.parseFeishuEvent(event, {
    verificationToken,
    encryptKey,
    inboundEnabled: true,
  });
  assert(parsed.kind === "challenge" && parsed.challenge === "chal-123", "challenge");
}

// Signature
{
  const body = JSON.stringify({ hello: "world" });
  const ts = "1710000000";
  const nonce = "abc";
  const sig = crypto.createHash("sha256").update(ts + nonce + encryptKey + body).digest("hex");
  assert(webhook.verifyFeishuSignature(ts, nonce, encryptKey, body, sig), "sig ok");
  assert(!webhook.verifyFeishuSignature(ts, nonce, encryptKey, body, "deadbeef"), "sig bad");
}

// Decrypt known sample from Feishu docs
{
  const plain = webhook.decryptFeishuEncrypt(
    "P37w+VZImNgPEO1RBhJ6RtKl7n6zymIbEG1pReEzghk=",
    "test key",
  );
  assert(plain === "hello world", `decrypt got ${plain}`);
}

// Schema 2.0 message
{
  const event = {
    schema: "2.0",
    header: {
      event_id: "ev_1",
      event_type: "im.message.receive_v1",
      token: verificationToken,
    },
    event: {
      sender: { sender_type: "user", sender_id: { open_id: "ou_x" } },
      message: {
        message_id: "om_1",
        chat_id: "oc_1",
        message_type: "text",
        content: JSON.stringify({ text: "帮我修一下登录" }),
      },
    },
  };
  const parsed = webhook.parseFeishuEvent(event, {
    verificationToken,
    encryptKey,
    inboundEnabled: true,
  });
  assert(parsed.kind === "message", "message kind");
  assert(parsed.text.includes("登录"), "message text");
  assert(parsed.deliveryKey === "ev_1", "delivery key");
}

// Bot ignored
{
  const event = {
    schema: "2.0",
    header: { event_id: "ev_bot", event_type: "im.message.receive_v1", token: verificationToken },
    event: {
      sender: { sender_type: "bot", sender_id: {} },
      message: { message_id: "om_b", message_type: "text", content: '{"text":"hi"}' },
    },
  };
  const parsed = webhook.parseFeishuEvent(event, {
    verificationToken,
    encryptKey,
    inboundEnabled: true,
  });
  assert(parsed.kind === "ignored" && parsed.reason === "bot_message", "bot ignored");
}

console.log("smoke-im-webhook: ok");
