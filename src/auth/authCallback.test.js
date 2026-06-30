import { describe, expect, it } from "vitest";
import { getAuthCallbackType } from "./authCallback.js";

describe("getAuthCallbackType", () => {
  it("识别邀请链接的 hash 回调", () => {
    expect(getAuthCallbackType("https://example.com/battlemap/#access_token=token&type=invite")).toBe("invite");
  });

  it("识别密码找回链接的 query 回调", () => {
    expect(getAuthCallbackType("https://example.com/battlemap/?type=recovery&code=abc")).toBe("recovery");
  });

  it("忽略普通访问和其他认证事件", () => {
    expect(getAuthCallbackType("https://example.com/battlemap/")).toBeNull();
    expect(getAuthCallbackType("https://example.com/battlemap/#type=signup")).toBeNull();
  });
});
