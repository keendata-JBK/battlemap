import { DWClient } from "dingtalk-stream";
import { loadConfig } from "./config.mjs";
import { sendProactiveMarkdown } from "./dingtalk-api.mjs";

function argument(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((item) => item.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : "";
}

const config = loadConfig();
const staffId = argument("staff-id");
const robotCode = argument("robot-code") || config.clientId;
if (!staffId) throw new Error("请通过 --staff-id 指定测试接收人的钉钉 staffId");

const client = new DWClient({
  clientId: config.clientId,
  clientSecret: config.clientSecret,
});
try {
  const accessToken = await client.getAccessToken();
  const result = await sendProactiveMarkdown({
    accessToken,
    robotCode,
    staffId,
    title: "AI 认知行动 · 通道测试",
    content: "钉钉主动通知通道已连接。\n\n这是一条仅发送给测试人员的验证消息，不会修改销售数据。",
  });
  console.info("主动通知测试发送成功", { processQueryKey: result.processQueryKey ?? "" });
} finally {
  client.disconnect();
}
