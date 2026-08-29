import {
  registerNotifyProvider,
  type GateNotifyPayload,
  type NotifyProvider,
  type TaskNotifyPayload,
} from "@agent-desk/provider-notify";

export interface FeishuNotifyProviderOptions {
  appId?: string;
  appSecret?: string;
  /** open_id / user_id / email / chat_id depending on receiveIdType */
  receiveId?: string;
  receiveIdType?: "open_id" | "user_id" | "union_id" | "email" | "chat_id";
  /** Default https://open.feishu.cn ; use https://open.larksuite.com for Lark intl */
  apiBase?: string;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

const MAX_CHOICE_BUTTONS = 3;

function originOf(webUrl: string): string {
  try {
    return new URL(webUrl).origin;
  } catch {
    return "http://127.0.0.1:19877";
  }
}

/** Deep link that resumes a gate choice via local GET (opens in browser). */
export function gateChoiceUrl(webUrl: string, taskId: string, reply: string): string {
  const base = originOf(webUrl);
  const tid = encodeURIComponent(taskId);
  const r = encodeURIComponent(reply);
  return `${base}/api/tasks/${tid}/resume?reply=${r}`;
}

function button(label: string, url: string, type: "default" | "primary" | "danger" = "default") {
  return {
    tag: "button",
    text: { tag: "plain_text", content: label.slice(0, 40) || "打开" },
    type,
    url,
    multi_url: {
      url,
      pc_url: url,
      android_url: url,
      ios_url: url,
    },
  };
}

export class FeishuNotifyProvider implements NotifyProvider {
  readonly id = "feishu";
  readonly displayName = "Feishu / Lark";

  private readonly appId: string;
  private readonly appSecret: string;
  private readonly receiveId: string;
  private readonly receiveIdType: NonNullable<FeishuNotifyProviderOptions["receiveIdType"]>;
  private readonly apiBase: string;
  private tokenCache: TokenCache | null = null;

  constructor(options: FeishuNotifyProviderOptions = {}) {
    this.appId = (options.appId ?? process.env.AD_FEISHU_APP_ID ?? "").trim();
    this.appSecret = (options.appSecret ?? process.env.AD_FEISHU_APP_SECRET ?? "").trim();
    this.receiveId = (options.receiveId ?? process.env.AD_FEISHU_RECEIVE_ID ?? "").trim();
    const idType = (
      options.receiveIdType ??
      process.env.AD_FEISHU_RECEIVE_ID_TYPE ??
      "open_id"
    ).trim() as FeishuNotifyProviderOptions["receiveIdType"];
    this.receiveIdType = idType || "open_id";
    this.apiBase = (
      options.apiBase ??
      process.env.AD_FEISHU_API_BASE ??
      "https://open.feishu.cn"
    )
      .trim()
      .replace(/\/$/, "");
  }

  private requireConfigured(): void {
    if (!this.appId || !this.appSecret) {
      throw new Error("Feishu notify needs AD_FEISHU_APP_ID and AD_FEISHU_APP_SECRET");
    }
  }

  private async tenantToken(): Promise<string> {
    this.requireConfigured();
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 60_000) {
      return this.tokenCache.token;
    }
    const res = await fetch(`${this.apiBase}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        app_id: this.appId,
        app_secret: this.appSecret,
      }),
    });
    const data = (await res.json()) as {
      code?: number;
      msg?: string;
      tenant_access_token?: string;
      expire?: number;
    };
    if (!res.ok || data.code !== 0 || !data.tenant_access_token) {
      throw new Error(
        `Feishu token failed: HTTP ${res.status} code=${data.code} ${data.msg ?? ""}`,
      );
    }
    this.tokenCache = {
      token: data.tenant_access_token,
      expiresAt: now + (data.expire ?? 7200) * 1000,
    };
    return data.tenant_access_token;
  }

  private async sendInteractive(card: Record<string, unknown>): Promise<void> {
    if (!this.receiveId) {
      throw new Error(
        "Feishu notify needs AD_FEISHU_RECEIVE_ID (open_id / email / chat_id, see AD_FEISHU_RECEIVE_ID_TYPE)",
      );
    }
    const token = await this.tenantToken();
    const url = `${this.apiBase}/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(this.receiveIdType)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        receive_id: this.receiveId,
        msg_type: "interactive",
        content: JSON.stringify(card),
      }),
    });
    const data = (await res.json()) as { code?: number; msg?: string };
    if (!res.ok || data.code !== 0) {
      throw new Error(
        `Feishu send message failed: HTTP ${res.status} code=${data.code} ${data.msg ?? ""}`,
      );
    }
  }

  async sendGate(payload: GateNotifyPayload): Promise<void> {
    const issue = payload.issueCode ? ` · ${payload.issueCode}` : "";
    const lines = [
      `**${payload.title || "Task"}**${issue}`,
      "",
      payload.gateHeading || "需要确认",
    ];
    const actions = payload.choices.slice(0, MAX_CHOICE_BUTTONS).map((c, i) =>
      button(
        c.label || c.value,
        gateChoiceUrl(payload.webUrl, payload.taskId, c.value),
        i === 0 ? "primary" : "default",
      ),
    );
    actions.push(button("打开任务", payload.webUrl, "default"));

    await this.sendInteractive({
      config: { wide_screen_mode: true },
      header: {
        template: "orange",
        title: { tag: "plain_text", content: "agent-desk 闸门确认" },
      },
      elements: [
        {
          tag: "div",
          text: { tag: "lark_md", content: lines.join("\n") },
        },
        {
          tag: "note",
          elements: [
            {
              tag: "plain_text",
              content: "按钮会打开本机 Web；请保持 oh web 在运行。",
            },
          ],
        },
        { tag: "action", actions },
      ],
    });
  }

  async sendTaskUpdate(payload: TaskNotifyPayload): Promise<void> {
    const issue = payload.issueCode ? ` · ${payload.issueCode}` : "";
    await this.sendInteractive({
      config: { wide_screen_mode: true },
      header: {
        template: payload.status === "failed" ? "red" : "blue",
        title: { tag: "plain_text", content: `任务 ${payload.status}` },
      },
      elements: [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: `**${payload.title || "Task"}**${issue}\n\n${payload.message || ""}`,
          },
        },
        {
          tag: "action",
          actions: [button("打开任务", payload.webUrl, "primary")],
        },
      ],
    });
  }
}

export function registerFeishuNotifyProvider(
  options?: FeishuNotifyProviderOptions,
): FeishuNotifyProvider {
  const provider = new FeishuNotifyProvider(options);
  registerNotifyProvider(provider);
  return provider;
}
