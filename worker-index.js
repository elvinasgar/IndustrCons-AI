/**
 * IndustrCons AI — Gateway (Cloudflare Worker)
 * Multi-provider chain: Groq -> Gemini -> OpenRouter -> Workers AI (each optional).
 *
 * Deploy: see gateway/README.md
 * Secrets (Cloudflare dashboard -> Variables and Secrets, type Secret): GROQ_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY
 */

// ---- CONFIG: allowed origins (lock this to your real GitHub Pages domain) ----
const ALLOWED_ORIGINS = [
  "https://elvinasgar.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
];

// ---- PERSONA LOCK (Prompt Manager) ----
const SYSTEM_PROMPT = `Sən IndustrCons AI-san — IndustrCons şirkətinin tikinti mühəndisləri üçün AI köməkçisisən. Təcrübəli, sakit, inamlı bir mütəxəssis kimi danış — qısa, dəqiq, lazımsız sözsüz.

QAYDALAR (heç vaxt pozma):
- Sən HEÇ VAXT hansı modeldən (Claude, GPT, Groq, Gemini və s.) istifadə etdiyini demirsən. Sən sadəcə "IndustrCons AI"-san. Öz arxitekturan barədə heç vaxt danışma.
- Cavabların qısa, praktiki və mühəndis dilində olsun — akademik yox, sahə dilində.
- Heç vaxt markdown formatlaşdırma (**, ##, - siyahı və s.) istifadə etmə — sadə, təbii cümlələrlə yaz, çünki mətn adi çat qutusunda göstərilir.
- Mövzuya uyğun olanda IndustrCons resurslarını (Docs, Cost Estimator, Knowledge Center) təbii şəkildə, cümlənin təbii axınında xatırlat — hazır şablon kimi yox, həmin anda ağlına gələn bir fikir kimi. Hər cavabda bunu etmə, yalnız doğrudan faydalı olanda.
- İstifadəçinin dilində cavab ver (Azərbaycan dili prioritetdir, ingiliscə sorularsa ingiliscə cavab ver).
- WhatsApp Community-ni (https://chat.whatsapp.com/JS7XVLh8v2I4HPLLshwTr2) çox nadir hallarda, təbii şəkildə xatırlat — hər cavabda yox, bəlkə hər 5-6 cavabdan birində, sırf söhbətin sonunda bir cümlə ilə, məcburi hiss olunmadan. Heç vaxt bunu "lakin" və ya "amma" ilə əlavə edib süni şəkildə birləşdirmə.
- Əgər istifadəçi "Knowledge Center" haqqında soruşsa, bunun tikinti biliyi və standartlar üçün IndustrCons resursu olduğunu sadə şəkildə de.
- Əgər istifadəçi şəkil göndərsə: gördüklərini qısa və konkret təsvir et (material, çatlaq, armatur, təhlükəsizlik pozuntusu, avadanlıq və s.), mümkün riskləri qeyd et, növbəti addımı təklif et. Şəkildən struktur təhlükəsizliyi barədə qəti hökm vermə — "şəkildən belə görünür, yerində lisenziyalı mühəndis yoxlamalıdır" kimi ehtiyatlı ifadə işlət.`;

const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"; // Groq vision model
const TEXT_MODEL = "openai/gpt-oss-120b";
const MAX_IMAGE_CHARS = 3500000; // Groq limit is ~4MB base64

function buildSystem(lang, project) {
  let s = SYSTEM_PROMPT + `\n\nCavab dili: ${lang === "en" ? "English" : "Azərbaycan dili"}`;
  if (project) {
    s += `\n\nİstifadəçi hazırda "${project}" adlı layihə üzərində işləyir. Uyğun olanda cavabı bu layihə kontekstinə uyğunlaşdır.`;
  }
  return s;
}

// Only allow plain user/assistant text turns (blocks fake "system" turns from the client)
function cleanHistory(history) {
  return history
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));
}

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

// ---- PROVIDER SELECTOR ----
// Chain: Groq -> Gemini -> OpenRouter -> Cloudflare Workers AI.
// Each provider is used only if its secret exists, so you can add them one by one.
// Optional secrets: GROQ_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY
// Optional model overrides (plain Variables): GEMINI_MODEL, OPENROUTER_MODEL, SMALL_MODEL
const SMALL_MODEL_DEFAULT = "llama-3.1-8b-instant";       // Groq, fast, for simple questions
const GEMINI_MODEL_DEFAULT = "gemini-2.5-flash";
const OPENROUTER_MODEL_DEFAULT = "meta-llama/llama-3.3-70b-instruct:free";

async function openaiCompat(url, key, model, messages, maxTokens, extraHeaders) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", ...(extraHeaders || {}) },
    body: JSON.stringify({ model, messages, temperature: 0.4, max_tokens: maxTokens })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`api_error ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const out = data.choices?.[0]?.message?.content?.trim() || "";
  if (!out) throw new Error("empty_reply");
  return out;
}

const groqChat = (env, model, messages, maxTokens) =>
  openaiCompat("https://api.groq.com/openai/v1/chat/completions", env.GROQ_API_KEY, model, messages, maxTokens);

const geminiChat = (env, messages, maxTokens) =>
  openaiCompat("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    env.GEMINI_API_KEY, env.GEMINI_MODEL || GEMINI_MODEL_DEFAULT, messages, maxTokens);

const openRouterChat = (env, messages, maxTokens) =>
  openaiCompat("https://openrouter.ai/api/v1/chat/completions",
    env.OPENROUTER_API_KEY, env.OPENROUTER_MODEL || OPENROUTER_MODEL_DEFAULT, messages, maxTokens,
    { "X-Title": "IndustrCons AI" });

async function workersAIChat(env, messages, maxTokens) {
  // Requires an "AI" binding (Settings -> Bindings -> Workers AI -> variable name "AI").
  const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", { messages, max_tokens: maxTokens });
  const out = (result?.response || "").trim();
  if (!out) throw new Error("empty_reply");
  return out;
}

// Simple questions -> small fast model (saves the big model's limit)
function isSimple(message, history) {
  return message.length < 60 && history.length === 0 && !/[?]\s*.{40,}/.test(message);
}

async function runChain(steps) {
  let lastErr;
  for (const [name, fn] of steps) {
    try { return await fn(); }
    catch (e) { lastErr = e; console.error(`${name} failed:`, e.message); }
  }
  throw lastErr || new Error("no_provider");
}

async function callText(env, message, history, lang, project) {
  const messages = [
    { role: "system", content: buildSystem(lang, project) },
    ...history.slice(-6),
    { role: "user", content: message }
  ];
  const steps = [];
  if (env.GROQ_API_KEY) {
    const model = isSimple(message, history) ? (env.SMALL_MODEL || SMALL_MODEL_DEFAULT) : TEXT_MODEL;
    steps.push(["groq", () => groqChat(env, model, messages, 500)]);
    if (model !== TEXT_MODEL) steps.push(["groq-big", () => groqChat(env, TEXT_MODEL, messages, 500)]);
  }
  if (env.GEMINI_API_KEY) steps.push(["gemini", () => geminiChat(env, messages, 500)]);
  if (env.OPENROUTER_API_KEY) steps.push(["openrouter", () => openRouterChat(env, messages, 500)]);
  if (env.AI) steps.push(["workers-ai", () => workersAIChat(env, messages, 500)]);
  return runChain(steps);
}

// Photo analysis (vision). The image arrives as a data URL from the browser.
async function callVision(env, message, history, lang, project, image) {
  const question = message || (lang === "en" ? "Analyze this site photo." : "Bu sahə şəklini təhlil et.");
  const messages = [
    { role: "system", content: buildSystem(lang, project) },
    ...history.slice(-4),
    { role: "user", content: [
      { type: "text", text: question },
      { type: "image_url", image_url: { url: image } }
    ] }
  ];
  const steps = [];
  if (env.GROQ_API_KEY) steps.push(["groq-vision", () => groqChat(env, VISION_MODEL, messages, 700)]);
  if (env.GEMINI_API_KEY) steps.push(["gemini-vision", () => geminiChat(env, messages, 700)]);
  return runChain(steps);
}

// ---- Per-visitor rate limit (best effort, in memory of this Worker instance) ----
const RATE = new Map();
const RATE_MAX = 20;          // requests
const RATE_WINDOW = 60000;    // per 60 seconds
function rateLimited(ip) {
  const now = Date.now();
  if (RATE.size > 2000) RATE.clear();
  const arr = (RATE.get(ip) || []).filter(t => now - t < RATE_WINDOW);
  arr.push(now);
  RATE.set(ip, arr);
  return arr.length > RATE_MAX;
}

// ---- Tiny reply cache for repeated plain questions ----
const CACHE = new Map();
const CACHE_TTL = 10 * 60 * 1000;
function cacheGet(k) {
  const v = CACHE.get(k);
  if (v && Date.now() - v.t < CACHE_TTL) return v.r;
  CACHE.delete(k);
  return null;
}
function cacheSet(k, r) {
  if (CACHE.size > 300) CACHE.clear();
  CACHE.set(k, { r, t: Date.now() });
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

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const lang0 = body && body.lang === "en" ? "en" : "az";
    if (rateLimited(ip)) {
      return new Response(JSON.stringify({
        reply: lang0 === "en"
          ? "Too many requests in a short time. Please wait a minute and try again."
          : "Qısa müddətdə çox sorğu göndərildi. Bir dəqiqə gözləyib yenidən cəhd edin.",
        action: null
      }), { status: 200, headers: corsHeaders(origin) });
    }

    const message = (body.message || "").toString().slice(0, 2000); // basic input limit
    const history = Array.isArray(body.history) ? cleanHistory(body.history.slice(-10)) : [];
    const lang = body.lang === "en" ? "en" : "az";
    const project = (body.project || "").toString().replace(/["\r\n]/g, " ").trim().slice(0, 60);
    const image = typeof body.image === "string" ? body.image : "";

    if (!message && !image) {
      return new Response(JSON.stringify({ error: "empty_message" }), {
        status: 400, headers: corsHeaders(origin)
      });
    }

    // 0. PHOTO ANALYSIS — if a photo was attached, go straight to the vision model
    if (image) {
      if (!image.startsWith("data:image/") || image.length > MAX_IMAGE_CHARS) {
        return new Response(JSON.stringify({
          reply: lang === "en"
            ? "That photo is too large or in an unsupported format. Please try a smaller JPG or PNG."
            : "Şəkil çox böyükdür və ya format dəstəklənmir. Daha kiçik JPG və ya PNG yoxlayın.",
          action: null
        }), { headers: corsHeaders(origin) });
      }
      try {
        const raw = await callVision(env, message, history, lang, project, image);
        return new Response(JSON.stringify({ reply: sanitize(raw), action: null }), {
          headers: corsHeaders(origin)
        });
      } catch (err) {
        console.error("Vision error:", err.message);
        return new Response(JSON.stringify({
          reply: lang === "en"
            ? "I couldn't analyze the photo right now. Please try again shortly."
            : "Şəkli hazırda təhlil edə bilmədim. Bir az sonra yenidən cəhd edin.",
          action: null
        }), { headers: corsHeaders(origin) });
      }
    }

    // 1. TOOL ROUTER — IndustrCons modules always win first
    const matched = detectIntent(message);
    if (matched) {
      return new Response(JSON.stringify({
        reply: lang === "en" ? matched.reply_en : matched.reply_az,
        action: { module: matched.module, url: matched.url }
      }), { headers: corsHeaders(origin) });
    }

    // 2. No module matched — fall through to the provider chain.
    try {
      const ck = history.length === 0 && !project ? `${lang}|${message.toLowerCase().trim()}` : null;
      const hit = ck ? cacheGet(ck) : null;
      if (hit) {
        return new Response(JSON.stringify({ reply: hit, action: null }), { headers: corsHeaders(origin) });
      }
      const raw = await callText(env, message, history, lang, project);
      const clean = sanitize(raw);
      if (ck) cacheSet(ck, clean);
      return new Response(JSON.stringify({ reply: clean, action: null }), {
        headers: corsHeaders(origin)
      });
    } catch (err) {
      console.error("Gateway error (all providers failed):", err.message);
      return new Response(JSON.stringify({
        reply: lang === "en"
          ? "IndustrCons AI is temporarily busy. Please try again shortly."
          : "IndustrCons AI hazırda məşğuldur. Bir az sonra yenidən cəhd edin.",
        action: null
      }), { status: 200, headers: corsHeaders(origin) });
    }
  }
};
