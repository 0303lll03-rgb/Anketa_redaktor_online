export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({
      ok: false,
      code: "method_not_supported",
      error: "Use GET for health check."
    });
    return;
  }

  res.status(200).json({
    ok: true,
    service: "anketa-crm-proxy",
    runtime: "serverless"
  });
};
