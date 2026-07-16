import { describe, expect, it } from "vitest";
import { getFunctionErrorMessage, isProjectContextSchemaError, stripProjectContextFields } from "./backendRepository.js";

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

  it("识别旧数据库缺少项目上下文字段的 schema cache 错误", () => {
    expect(isProjectContextSchemaError({ code: "PGRST204", message: "Could not find the 'competitor_description' column of 'projects' in the schema cache" })).toBe(true);
    expect(isProjectContextSchemaError({ message: "permission denied" })).toBe(false);
  });

  it("兼容保存时只移除旧数据库不支持的新增字段", () => {
    expect(stripProjectContextFields({
      name: "测试项目",
      description: "需求",
      decision_chain_description: "决策链",
      competitor_description: "竞争对手",
      referral_unit: "牵线单位",
      amount: 100,
    })).toEqual({ name: "测试项目", amount: 100 });
  });
});
