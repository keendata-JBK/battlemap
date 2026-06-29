const boundaryBase = "https://geo.datav.aliyun.com/areas_v3/bound";
const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": allowedOrigin, "Access-Control-Allow-Methods": "GET, OPTIONS" } });
  }
  const url = new URL(request.url);
  const adcode = url.searchParams.get("adcode") ?? "";
  const full = url.searchParams.get("full") === "true";
  if (!/^\d{6}$/.test(adcode)) return new Response("Invalid adcode", { status: 400 });

  const upstream = await fetch(`${boundaryBase}/${adcode}${full ? "_full" : ""}.json`, { headers: { Accept: "application/json" } });
  if (!upstream.ok) return new Response("Boundary not found", { status: upstream.status });
  return new Response(await upstream.arrayBuffer(), {
    headers: {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
});
