import http from "node:http";

export function startHealthServer({ port, state, logger = console }) {
  const server = http.createServer((request, response) => {
    if (request.method === "GET" && (request.url === "/health" || request.url === "/")) {
      const healthy = state.streamConnected !== false;
      response.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({
        service: "battlemap-dingtalk-connector",
        status: healthy ? "ok" : "degraded",
        streamConnected: state.streamConnected,
        startedAt: state.startedAt,
        checkedAt: new Date().toISOString(),
      }));
      return;
    }
    response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Not found" }));
  });
  server.listen(port, "0.0.0.0", () => logger.info(`健康检查已启动：http://127.0.0.1:${port}/health`));
  return server;
}
