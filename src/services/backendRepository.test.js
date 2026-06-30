import { describe, expect, it } from "vitest";
import { getFunctionErrorMessage } from "./backendRepository.js";

describe("getFunctionErrorMessage", () => {
  it("优先展示 Edge Function 返回的业务错误", async () => {
    const error = {
      message: "Edge Function returned a non-2xx status code",
      context: new Response(JSON.stringify({ error: "邮件发送频率受限" }), { status: 429 }),
    };
    await expect(getFunctionErrorMessage(error)).resolves.toBe("邮件发送频率受限");
  });

  it("没有响应正文时保留客户端错误", async () => {
    await expect(getFunctionErrorMessage({ message: "网络连接失败" })).resolves.toBe("网络连接失败");
  });
});
