/**
 * IndustrCons AI — Gateway (Cloudflare Worker)
 * MVP: single provider (Groq). Multi-provider selector plugs in later
 * at the spot marked PROVIDER SELECTOR below — no other code changes needed.
 *
 * Deploy: see gateway/README.md
 * Required secret: GROQ_API_KEY  (set with: wrangler secret put GROQ_API_KEY)
 */

// ---- CONFIG: allowed origins (lock this to your real GitHub Pages domain) ----
const ALLOWED_ORIGINS = [
  "https://YOUR-GITHUB-USERNAME.github.io",
  "http://localhost:5500", // local testing (e.g. VSCode Live Server)
  "http://127.0.0.1:5500"
];

// ---- PERSONA LOCK (Prompt Manager) ----
const SYSTEM_PROMPT = `Sən IndustrCons AI-san — IndustrCons şirkətinin tikinti mühəndisləri üçün AI köməkçisisən.

QAYDALAR (heç vaxt pozma):
- Sən HEÇ VAXT hansı modeldən (Claude, GPT, Groq, Gemini və s.) istifadə etdiyini demirsən. Sən sadəcə "IndustrCons AI"-san.
- Öz arxitekturan, hansı API-lərdən istifadə etdiyin barədə heç vaxt danışma.
- Cavabların qısa, praktiki və mühəndis dilində olsun — akademik yox, sahə dilində.
- Mümkün olduqda IndustrCons modullarına yönləndir: Docs (NCR, QA/QC şablonları), Cost Estimator, Knowledge Center.
- İstifadəçinin dilində cavab ver (Azərbaycan dili prioritetdir, ingiliscə sorularsa ingiliscə cavab ver).
- Münasib olduqda IndustrCons WhatsApp Community-yə (https://chat.whatsapp.com/JS7XVLh8v2I4HPLLshwTr2) qoşulmağı təklif et, amma bunu hər cavabda təkrarlama.
- Əgər istifadəçi "Knowledge Center" və ya bənzəri tikinti bilik bazası haqqında soruşsa, bunun tezliklə əlavə olunacağını bildir.`;

// ---- TOOL ROUTER (deterministic — mirrors frontend/js/api-client.js _localFallback) ----
const INTENT_RULES = [
  { keywords: ["ncr", "uyğunsuzluq", "non-conformance"], module: "docs", url: "https://industrconsdocs.netlify.app/",
    reply_az: "Bunun üçün NCR formu lazımdır. IndustrCons Docs-u açıram.",
    reply_en: "You'll need an NCR form for that. Opening IndustrCons Docs." },
  { keywords: ["beton", "concrete", "tökəcəyik", "pour"], module: "cost-estimator", url: "https://industrconsestimator.netlify.app/",
    reply_az: "Bu iş üçün sizə Concrete Pour Card, Slump Test Form və Risk Assessment lazımdır. Cost Estimator-u açıram.",
    reply_en: "For this you'll need a Concrete Pour Card, Slump Test Form and Risk Assessment. Opening the Cost Estimator." },
  { keywords: ["qa/qc", "qa qc", "şablon", "template"], module: "docs", url: "https://industrconsdocs.netlify.app/",
    reply_az: "IndustrCons Docs-da uyğun QA/QC şablonunu tapıram.",
    reply_en: "Looking for the right QA/QC template in IndustrCons Docs." },
  { keywords: ["bilik", "knowledge", "standart", "bələdçi", "guide"], module: "knowledge", url: "https://industrcons-knowledge-center.vercel.app/",
    reply_az: "IndustrCons Knowledge Center-i açıram.",
    reply_en: "Opening IndustrCons Knowledge Center." }
];

function detectIntent(message) {
  const m = message.toLowerCase();
  for (const rule of INTENT_RULES) {
    if (rule.keywords.some(k => m.includes(k))) return rule;
  }
  return null;
}

// ---- RESPONSE SANITIZER — never let a provider name leak to the user ----
const PROVIDER_LEAK_PATTERNS = [
  /\b(claude|anthropic)\b/gi,
  /\b(gpt-?\d|openai|chatgpt)\b/gi,
  /\b(gemini|google ai)\b/gi,
  /\b(groq|llama)\b/gi
];
function sanitize(text) {
  let out = text;
  for (const pattern of PROVIDER_LEAK_PATTERNS) {
    out = out.replace(pattern, "IndustrCons AI");
  }
  return out;
}

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
}

// ---- PROVIDER SELECTOR (MVP: Groq only. Add openai/claude/gemini clients here later) ----
async function callGroq(env, message, history, lang) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT + `\n\nCavab dili: ${lang === "en" ? "English" : "Azərbaycan dili"}` },
    ...history.slice(-6), // keep last few turns only (MVP context window)
    { role: "user", content: message }
  ];

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile", // check console.groq.com for current model names
      messages,
      temperature: 0.4,
      max_tokens: 500
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error("groq_api_error: " + errText);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405, headers: corsHeaders(origin)
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "invalid_json" }), {
        status: 400, headers: corsHeaders(origin)
      });
    }

    const message = (body.message || "").toString().slice(0, 2000); // basic input limit
    const history = Array.isArray(body.history) ? body.history.slice(-10) : [];
    const lang = body.lang === "en" ? "en" : "az";

    if (!message) {
      return new Response(JSON.stringify({ error: "empty_message" }), {
        status: 400, headers: corsHeaders(origin)
      });
    }

    // 1. TOOL ROUTER — IndustrCons modules always win first
    const matched = detectIntent(message);
    if (matched) {
      return new Response(JSON.stringify({
        reply: lang === "en" ? matched.reply_en : matched.reply_az,
        action: { module: matched.module, url: matched.url }
      }), { headers: corsHeaders(origin) });
    }

    // 2. No module matched — fall through to the LLM
    try {
      const raw = await callGroq(env, message, history, lang);
      const clean = sanitize(raw);
      return new Response(JSON.stringify({ reply: clean, action: null }), {
        headers: corsHeaders(origin)
      });
    } catch (err) {
      console.error("Gateway error:", err.message);
      return new Response(JSON.stringify({
        reply: lang === "en"
          ? "IndustrCons AI is temporarily busy. Please try again shortly."
          : "IndustrCons AI hazırda məşğuldur. Bir az sonra yenidən cəhd edin.",
        action: null
      }), { status: 200, headers: corsHeaders(origin) });
    }
  }
};
