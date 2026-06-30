const PASSWORD_CALLBACK_TYPES = new Set(["invite", "recovery"]);

export function getAuthCallbackType(input) {
  if (!input) return null;

  try {
    const url = new URL(input, "http://localhost");
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    const type = hash.get("type") ?? url.searchParams.get("type");
    return PASSWORD_CALLBACK_TYPES.has(type) ? type : null;
  } catch {
    return null;
  }
}

export function clearAuthCallbackUrl() {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  ["code", "type", "error", "error_code", "error_description"].forEach((key) => {
    url.searchParams.delete(key);
  });
  url.hash = "";
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
}
