import type { DingTalkCardCallbackEvent, DingTalkCardCallbackResponse } from "./stream.js";
import { parseGateOutTrackId, replyFromCardCallback } from "./card-track.js";

export interface DingTalkGateResumeHandlerOptions {
  /**
   * Resume a task with the user's card reply.
   * Should throw or return { ok:false } on failure.
   */
  resume: (
    taskId: string,
    reply: string,
    event: DingTalkCardCallbackEvent,
  ) => Promise<{ ok: boolean; message?: string } | void>;
}

/**
 * Build an onCardCallback that maps interactive-card clicks to task resume.
 */
export function createDingTalkGateResumeHandler(
  options: DingTalkGateResumeHandlerOptions,
): (event: DingTalkCardCallbackEvent) => Promise<DingTalkCardCallbackResponse> {
  return async (event) => {
    const stamp = new Date().toLocaleString("zh-CN", { hour12: false });
    const taskId = parseGateOutTrackId(event.outTrackId);
    const reply = replyFromCardCallback(event);

    if (!taskId) {
      return {
        cardUpdateOptions: { updateCardDataByKey: true },
        cardData: {
          cardParamMap: {
            description: `已收到点击，但 outTrackId 无法解析为任务（${stamp}）\noutTrackId=${event.outTrackId || "(none)"}`,
          },
        },
      };
    }

    if (!reply) {
      return {
        cardUpdateOptions: { updateCardDataByKey: true },
        cardData: {
          cardParamMap: {
            description: `任务 ${taskId}：未拿到回复内容，请重试或使用输入框提交（${stamp}）`,
          },
        },
      };
    }

    try {
      const result = await options.resume(taskId, reply, event);
      const ok = result == null ? true : Boolean(result.ok);
      const extra = result && "message" in result && result.message ? `\n${result.message}` : "";
      return {
        cardUpdateOptions: { updateCardDataByKey: true },
        cardData: {
          cardParamMap: {
            description: ok
              ? `已提交回复「${reply}」到任务 ${taskId}（${stamp}）${extra}`
              : `提交失败：${result?.message || "unknown"}（${stamp}）`,
          },
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        cardUpdateOptions: { updateCardDataByKey: true },
        cardData: {
          cardParamMap: {
            description: `提交失败：${msg}（${stamp}）`,
          },
        },
      };
    }
  };
}
