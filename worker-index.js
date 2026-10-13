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
// Primary: Groq (fast, cheap). Fallback: Cloudflare Workers AI (used automatically if Groq
// fails or times out). Add more providers here later the same way.
async function groqChat(env, model, messages, maxTokens) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model, messages, temperature: 0.4, max_tokens: maxTokens })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error("groq_api_error: " + errText);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

async function callGroq(env, message, history, lang, project) {
  const messages = [
    { role: "system", content: buildSystem(lang, project) },
    ...history.slice(-6), // keep last few turns only
    { role: "user", content: message }
  ];
  return groqChat(env, TEXT_MODEL, messages, 500);
}

// Photo analysis (vision). The image arrives as a data URL from the browser.
async function callGroqVision(env, message, history, lang, project, image) {
  const question = message || (lang === "en"
    ? "Analyze this site photo."
    : "Bu sahə şəklini təhlil et.");
  const messages = [
    { role: "system", content: buildSystem(lang, project) },
    ...history.slice(-4),
    {
      role: "user",
      content: [
        { type: "text", text: question },
        { type: "image_url", image_url: { url: image } }
      ]
    }
  ];
  return groqChat(env, VISION_MODEL, messages, 700);
}

async function callWorkersAI(env, message, history, lang, project) {
  // Cloudflare Workers AI — included free with your Cloudflare account.
  // Requires an "AI" binding on this Worker (Settings → Bindings → Add → Workers AI → variable name "AI").
  const messages = [
    { role: "system", content: buildSystem(lang, project) },
    ...history.slice(-6),
    { role: "user", content: message }
  ];

  const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
    messages,
    max_tokens: 500
  });

  return (result?.response || "").trim();
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
        const raw = await callGroqVision(env, message, history, lang, project, image);
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

    // 2. No module matched — fall through to the LLM.
    // Try Groq first (fast). If it fails, automatically fall back to Workers AI.
    try {
      let raw;
      try {
        raw = await callGroq(env, message, history, lang, project);
      } catch (groqErr) {
        console.error("Groq failed, falling back to Workers AI:", groqErr.message);
        raw = await callWorkersAI(env, message, history, lang, project);
      }
      const clean = sanitize(raw);
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
