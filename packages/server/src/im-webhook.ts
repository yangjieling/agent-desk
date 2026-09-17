/**
 * Feishu / Lark event subscription helpers (challenge, signature, decrypt, parse).
 * Docs: open.feishu.cn event subscription + Encrypt Key.
 */
import { createHash, createDecipheriv, timingSafeEqual } from "node:crypto";
import { headerString } from "./autopilot-webhook.js";

export const IM_WEBHOOK_MAX_BYTES = 256 * 1024;

export type FeishuInboundConfig = {
  verificationToken: string;
  encryptKey: string;
  inboundEnabled: boolean;
};

export function verifyFeishuSignature(
  timestamp: string,
  nonce: string,
  encryptKey: string,
  rawBody: string,
  signatureHeader: string | undefined,
): boolean {
  const sig = String(signatureHeader || "").trim();
  if (!encryptKey || !sig || !timestamp || !nonce) return false;
  const expected = createHash("sha256")
    .update(timestamp + nonce + encryptKey + rawBody, "utf8")
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** AES-256-CBC decrypt of Feishu `encrypt` field (key = SHA256(encryptKey)). */
export function decryptFeishuEncrypt(encryptBase64: string, encryptKey: string): string {
  const key = createHash("sha256").update(encryptKey, "utf8").digest();
  const buf = Buffer.from(encryptBase64, "base64");
  if (buf.length < 16) throw new Error("feishu_encrypt_too_short");
  const iv = buf.subarray(0, 16);
  const data = buf.subarray(16);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  return plain.toString("utf8");
}

export function parseJsonObject(text: string): Record<string, unknown> {
  const obj = JSON.parse(text) as unknown;
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("feishu_payload_not_object");
  }
  return obj as Record<string, unknown>;
}

/**
 * Resolve the event JSON object from raw body (decrypt when `encrypt` present).
 */
export function resolveFeishuEventBody(
  rawBody: string,
  parsed: unknown,
  encryptKey: string,
): Record<string, unknown> {
  const root =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : parseJsonObject(rawBody || "{}");
  const enc = typeof root.encrypt === "string" ? root.encrypt.trim() : "";
  if (!enc) return root;
  if (!encryptKey) throw new Error("feishu_encrypt_key_required");
  return parseJsonObject(decryptFeishuEncrypt(enc, encryptKey));
}

export type FeishuChallengeResult = {
  kind: "challenge";
  challenge: string;
};

export type FeishuMessageResult = {
  kind: "message";
  deliveryKey: string;
  text: string;
  senderName: string;
  chatId: string;
  messageId: string;
  eventType: string;
  rawEvent: Record<string, unknown>;
};

export type FeishuIgnoredResult = {
  kind: "ignored";
  reason: string;
  deliveryKey: string;
};

export type FeishuParsedEvent = FeishuChallengeResult | FeishuMessageResult | FeishuIgnoredResult;

export function parseFeishuEvent(
  event: Record<string, unknown>,
  cfg: FeishuInboundConfig,
): FeishuParsedEvent {
  const type = String(event.type || "").trim();
  if (type === "url_verification") {
    const token = String(event.token || "").trim();
    if (cfg.verificationToken && token && token !== cfg.verificationToken) {
      throw Object.assign(new Error("invalid_verification_token"), { code: "invalid_token" });
    }
    const challenge = String(event.challenge || "").trim();
    if (!challenge) throw new Error("missing_challenge");
    return { kind: "challenge", challenge };
  }

  // Schema 2.0
  const header =
    event.header && typeof event.header === "object" && !Array.isArray(event.header)
      ? (event.header as Record<string, unknown>)
      : null;
  if (header) {
    const token = String(header.token || "").trim();
    if (cfg.verificationToken && token && token !== cfg.verificationToken) {
      throw Object.assign(new Error("invalid_verification_token"), { code: "invalid_token" });
    }
    const eventType = String(header.event_type || "").trim();
    const eventId = String(header.event_id || "").trim();
    const body =
      event.event && typeof event.event === "object" && !Array.isArray(event.event)
        ? (event.event as Record<string, unknown>)
        : {};
    if (eventType !== "im.message.receive_v1") {
      return {
        kind: "ignored",
        reason: `unsupported_event:${eventType || "unknown"}`,
        deliveryKey: eventId || `ignore_${Date.now()}`,
      };
    }
    const message =
      body.message && typeof body.message === "object" && !Array.isArray(body.message)
        ? (body.message as Record<string, unknown>)
        : {};
    const sender =
      body.sender && typeof body.sender === "object" && !Array.isArray(body.sender)
        ? (body.sender as Record<string, unknown>)
        : {};
    if (String(sender.sender_type || "") === "bot") {
      return {
        kind: "ignored",
        reason: "bot_message",
        deliveryKey: eventId || String(message.message_id || "") || `bot_${Date.now()}`,
      };
    }
    const messageId = String(message.message_id || "").trim();
    const chatId = String(message.chat_id || "").trim();
    const messageType = String(message.message_type || "").trim();
    if (messageType && messageType !== "text") {
      return {
        kind: "ignored",
        reason: `non_text:${messageType}`,
        deliveryKey: eventId || messageId || `nt_${Date.now()}`,
      };
    }
    const text = extractFeishuTextContent(String(message.content || ""));
    if (!text.trim()) {
      return {
        kind: "ignored",
        reason: "empty_text",
        deliveryKey: eventId || messageId || `empty_${Date.now()}`,
      };
    }
    const senderId =
      sender.sender_id && typeof sender.sender_id === "object"
        ? (sender.sender_id as Record<string, unknown>)
        : {};
    const senderName =
      String(senderId.open_id || senderId.user_id || senderId.union_id || "").trim() || "feishu";
    return {
      kind: "message",
      deliveryKey: eventId || messageId || `msg_${Date.now()}`,
      text: text.trim(),
      senderName,
      chatId,
      messageId,
      eventType,
      rawEvent: event,
    };
  }

  // Legacy v1 callback envelope
  if (type === "event_callback") {
    const token = String(event.token || "").trim();
    if (cfg.verificationToken && token && token !== cfg.verificationToken) {
      throw Object.assign(new Error("invalid_verification_token"), { code: "invalid_token" });
    }
    const body =
      event.event && typeof event.event === "object" && !Array.isArray(event.event)
        ? (event.event as Record<string, unknown>)
        : {};
    const evType = String(body.type || "").trim();
    if (evType !== "message" && evType !== "im.message.receive_v1") {
      return {
        kind: "ignored",
        reason: `unsupported_event:${evType || "unknown"}`,
        deliveryKey: String(event.uuid || body.open_message_id || `ignore_${Date.now()}`),
      };
    }
    const text =
      String(body.text_without_at_bot || body.text || "").trim() ||
      extractFeishuTextContent(String(body.content || ""));
    if (!text) {
      return {
        kind: "ignored",
        reason: "empty_text",
        deliveryKey: String(event.uuid || `empty_${Date.now()}`),
      };
    }
    return {
      kind: "message",
      deliveryKey: String(event.uuid || body.open_message_id || `msg_${Date.now()}`),
      text,
      senderName: String(body.employee_id || body.open_id || body.user_id || "feishu"),
      chatId: String(body.open_chat_id || body.chat_id || ""),
      messageId: String(body.open_message_id || body.message_id || ""),
      eventType: evType,
      rawEvent: event,
    };
  }

  return {
    kind: "ignored",
    reason: `unsupported_envelope:${type || "unknown"}`,
    deliveryKey: `ignore_${Date.now()}`,
  };
}

function extractFeishuTextContent(content: string): string {
  const raw = String(content || "").trim();
  if (!raw) return "";
  try {
    const obj = JSON.parse(raw) as { text?: string };
    if (typeof obj.text === "string") return obj.text;
  } catch {
    /* plain text */
  }
  return raw;
}

export function feishuHeadersFromRequest(headers: Record<string, unknown>): {
  timestamp: string;
  nonce: string;
  signature: string | undefined;
} {
  return {
    timestamp: String(headerString(headers, "x-lark-request-timestamp") || "").trim(),
    nonce: String(headerString(headers, "x-lark-request-nonce") || "").trim(),
    signature: headerString(headers, "x-lark-signature"),
  };
}
