const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function sendCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
}

function sendError(res, status, code, error, details) {
  const payload = { ok: false, code, error };
  if (details) payload.details = details;
  res.status(status).json(payload);
}

function normalizeLink(rawLink) {
  const value = String(rawLink || "").trim();
  if (!value) throw new Error("link_format_invalid");
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function assertAllowedHost(url) {
  const host = url.hostname.toLowerCase();
  if (host === "roapp.link" || host === "roapp.page" || host.endsWith(".roapp.page")) return;
  throw new Error("domain_not_allowed");
}

function buildCrmApiUrl(url) {
  const segments = url.pathname.split("/").filter(Boolean);
  const apiIndex = segments.indexOf("api");
  const wIndex = segments.indexOf("w");

  if (
    apiIndex >= 0 &&
    segments[apiIndex + 1] === "w" &&
    segments[apiIndex + 2] &&
    segments[apiIndex + 3]
  ) {
    return `${url.origin}/api/w/${segments[apiIndex + 2]}/${segments[apiIndex + 3]}`;
  }

  if (wIndex >= 0 && segments[wIndex + 1] && segments[wIndex + 2]) {
    return `${url.origin}/api/w/${segments[wIndex + 1]}/${segments[wIndex + 2]}`;
  }

  return "";
}

function getPreview(text, length = 700) {
  const singleLine = String(text || "").replace(/\s+/g, " ").trim();
  return singleLine.length > length ? singleLine.slice(0, length) : singleLine;
}

function findApiUrlInHtml(html, baseUrl) {
  if (!html) return "";

  const patterns = [
    /https?:\/\/[^"'<> ]+\/api\/w\/[^"'<> ]+\/[^"'<> /]+/i,
    /\/api\/w\/[^"'<> ]+\/[^"'<> /]+/i
  ];

  for (const pattern of patterns) {
    const match = String(html).match(pattern);
    if (!match) continue;
    return match[0].startsWith("http") ? match[0] : `${baseUrl.origin}${match[0]}`;
  }

  return "";
}

async function fetchCrm(url, accept, referer = "") {
  const headers = {
    Accept: accept,
    "X-Language": "uk",
    "User-Agent": BROWSER_USER_AGENT
  };

  if (referer) headers.Referer = referer;

  return fetch(url, {
    redirect: "follow",
    headers
  });
}

async function resolveCrmApiContext(rawLink) {
  let inputUrl;
  try {
    inputUrl = new URL(normalizeLink(rawLink));
  } catch {
    const error = new Error("Invalid CRM URL.");
    error.code = "link_format_invalid";
    throw error;
  }

  try {
    assertAllowedHost(inputUrl);
  } catch {
    const error = new Error("Domain is not allowed.");
    error.code = "domain_not_allowed";
    throw error;
  }

  const directApiUrl = buildCrmApiUrl(inputUrl);
  if (directApiUrl) {
    return {
      apiUrl: directApiUrl,
      pageUrl: inputUrl.href,
      source: "url"
    };
  }

  let pageResponse;
  try {
    pageResponse = await fetchCrm(
      inputUrl.href,
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    );
  } catch (cause) {
    const error = new Error("CRM short link could not be opened.");
    error.code = "short_link_resolve_failed";
    error.details = { message: cause?.message || "" };
    throw error;
  }

  const finalUrl = new URL(pageResponse.url || inputUrl.href);
  assertAllowedHost(finalUrl);

  const apiFromFinalUrl = buildCrmApiUrl(finalUrl);
  if (apiFromFinalUrl) {
    return {
      apiUrl: apiFromFinalUrl,
      pageUrl: finalUrl.href,
      source: "final_url"
    };
  }

  const contentType = pageResponse.headers.get("content-type") || "";
  const pageText = await pageResponse.text();

  if (contentType.includes("html") || /<!doctype|<html/i.test(pageText)) {
    const apiFromHtml = findApiUrlInHtml(pageText, finalUrl);
    if (apiFromHtml) {
      return {
        apiUrl: apiFromHtml,
        pageUrl: finalUrl.href,
        source: "html"
      };
    }
  }

  const error = new Error("CRM API URL was not found.");
  error.code = "api_url_not_found";
  error.details = {
    finalUrl: finalUrl.href,
    contentType,
    preview: getPreview(pageText)
  };
  throw error;
}

async function getCrmOrder(rawLink) {
  const context = await resolveCrmApiContext(rawLink);
  let apiResponse;

  try {
    apiResponse = await fetchCrm(
      context.apiUrl,
      "application/json, text/plain, */*",
      context.pageUrl
    );
  } catch (cause) {
    const error = new Error("CRM request failed.");
    error.code = "crm_request_failed";
    error.details = { message: cause?.message || "" };
    throw error;
  }

  const contentType = apiResponse.headers.get("content-type") || "";
  const text = await apiResponse.text();
  const trimmed = text.trimStart();

  if (!apiResponse.ok) {
    const error = new Error(`CRM returned HTTP ${apiResponse.status}.`);
    error.code = `crm_http_${apiResponse.status}`;
    error.details = {
      status: apiResponse.status,
      contentType,
      preview: getPreview(text)
    };
    throw error;
  }

  if (!contentType.includes("json") && !trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    const error = new Error("CRM returned non-JSON content.");
    error.code = "crm_non_json";
    error.details = {
      status: apiResponse.status,
      contentType,
      preview: getPreview(text),
      apiUrl: context.apiUrl,
      pageUrl: context.pageUrl
    };
    throw error;
  }

  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("CRM JSON could not be parsed.");
    error.code = "crm_json_parse_failed";
    error.details = {
      contentType,
      preview: getPreview(text)
    };
    throw error;
  }
}

export default async function handler(req, res) {
  sendCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    sendError(res, 405, "method_not_supported", "Use POST for CRM import.");
    return;
  }

  const url = req.body?.url;
  if (!url) {
    sendError(res, 400, "missing_url", "Missing CRM url.");
    return;
  }

  try {
    const data = await getCrmOrder(url);
    res.status(200).json(data);
  } catch (error) {
    const code = error.code || "crm_request_failed";
    const status =
      code === "link_format_invalid" ||
      code === "domain_not_allowed" ||
      code === "missing_url"
        ? 400
        : 502;

    sendError(res, status, code, error.message || "CRM import failed.", error.details);
  }
};
