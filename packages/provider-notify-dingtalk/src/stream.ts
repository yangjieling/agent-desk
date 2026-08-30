import { DWClient, TOPIC_CARD, type DWClientDownStream } from "dingtalk-stream";
import { resolveDingTalkConfig } from "./resolve.js";

export interface DingTalkStreamOptions {
  clientId?: string;
  clientSecret?: string;
  /** Extra logging (token / reconnect). Default false. */
  debug?: boolean;
  /**
   * Called for every card callback. Return a response object to update the
   * card, or void/undefined for an empty ACK.
   */
  onCardCallback?: (event: DingTalkCardCallbackEvent) =>
    | DingTalkCardCallbackResponse
    | void
    | Promise<DingTalkCardCallbackResponse | void>;
}

export interface DingTalkCardCallbackEvent {
  messageId: string;
  outTrackId?: string;
  userId?: string;
  actionIds: string[];
  params: Record<string, unknown>;
  /** Raw parsed Stream `data` payload. */
  raw: Record<string, unknown>;
}

export interface DingTalkCardCallbackResponse {
  cardUpdateOptions?: {
    updateCardDataByKey?: boolean;
    updatePrivateDataByKey?: boolean;
  };
  cardData?: { cardParamMap?: Record<string, string> };
  userPrivateData?: { cardParamMap?: Record<string, string> };
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function stringMap(obj: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
}

/** Parse Stream TOPIC_CARD payload into a stable shape. */
export function parseDingTalkCardCallback(
  message: DWClientDownStream,
): DingTalkCardCallbackEvent {
  const raw = asRecord(JSON.parse(message.data || "{}"));
  let content = asRecord(raw.content);
  if (typeof raw.content === "string") {
    try {
      content = asRecord(JSON.parse(raw.content));
    } catch {
      content = {};
    }
  }
  const privateData = asRecord(content.cardPrivateData);
  const actionIds = Array.isArray(privateData.actionIds)
    ? privateData.actionIds.map(String)
    : [];
  const params = asRecord(privateData.params);

  return {
    messageId: message.headers?.messageId ?? "",
    outTrackId:
      typeof raw.outTrackId === "string"
        ? raw.outTrackId
        : typeof raw.outTrackID === "string"
          ? raw.outTrackID
          : undefined,
    userId:
      typeof raw.userId === "string"
        ? raw.userId
        : typeof raw.staffId === "string"
          ? raw.staffId
          : undefined,
    actionIds,
    params,
    raw,
  };
}

/**
 * Start a DingTalk Stream client that listens for interactive-card callbacks.
 * Only one Stream connection should run per clientId at a time.
 */
export async function startDingTalkCardStream(
  options: DingTalkStreamOptions = {},
): Promise<DWClient> {
  const resolved = resolveDingTalkConfig();
  const clientId = (options.clientId ?? resolved.appKey).trim();
  const clientSecret = (options.clientSecret ?? resolved.appSecret).trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      "DingTalk Stream needs AppKey/AppSecret (env AD_DINGTALK_APP_* or Settings → 钉钉)",
    );
  }

  const client = new DWClient({
    clientId,
    clientSecret,
    debug: options.debug ?? false,
  });

  client.registerCallbackListener(TOPIC_CARD, async (res: DWClientDownStream) => {
    let event: DingTalkCardCallbackEvent;
    try {
      event = parseDingTalkCardCallback(res);
    } catch (err) {
      console.error(
        "[dingtalk-stream] failed to parse card callback:",
        err instanceof Error ? err.message : err,
      );
      console.error("[dingtalk-stream] raw data:", res.data);
      client.socketCallBackResponse(res.headers.messageId, {});
      return;
    }

    console.log("[dingtalk-stream] card callback");
    console.log(
      JSON.stringify(
        {
          messageId: event.messageId,
          outTrackId: event.outTrackId,
          userId: event.userId,
          actionIds: event.actionIds,
          params: event.params,
        },
        null,
        2,
      ),
    );

    let response: DingTalkCardCallbackResponse = {};
    try {
      const custom = await options.onCardCallback?.(event);
      if (custom) {
        response = {
          ...custom,
          cardData: custom.cardData
            ? {
                cardParamMap: stringMap(
                  (custom.cardData.cardParamMap ?? {}) as Record<string, unknown>,
                ),
              }
            : undefined,
          userPrivateData: custom.userPrivateData
            ? {
                cardParamMap: stringMap(
                  (custom.userPrivateData.cardParamMap ?? {}) as Record<
                    string,
                    unknown
                  >,
                ),
              }
            : undefined,
        };
      }
    } catch (err) {
      console.error(
        "[dingtalk-stream] onCardCallback error:",
        err instanceof Error ? err.message : err,
      );
    }

    client.socketCallBackResponse(res.headers.messageId, response);
  });

  await client.connect();
  console.log(
    `[dingtalk-stream] connected (clientId=${clientId}); listening ${TOPIC_CARD}`,
  );
  return client;
}
