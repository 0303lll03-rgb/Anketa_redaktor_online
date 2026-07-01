(function () {
  const LOCAL_API_BASE_URL = "http://127.0.0.1:8788";

  // For hosting: set this to your deployed CRM backend URL, for example:
  // "https://your-backend-domain.com"
  // If frontend and backend share one domain, use an empty string: "".
  const PRODUCTION_API_BASE_URL = "";

  const isLocal =
    window.location.protocol === "file:" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost";

  window.ANKETA_CONFIG = {
    API_BASE_URL: isLocal ? LOCAL_API_BASE_URL : PRODUCTION_API_BASE_URL,
    HEALTH_ENDPOINT: isLocal ? "/health" : "/api/health",
    CRM_IMPORT_ENDPOINT: "/api/crm-import",
    CRM_PROXY_PORT: 8788
  };
})();
