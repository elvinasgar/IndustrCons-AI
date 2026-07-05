/**
 * IndustrCons AI — API Client
 * Talks ONLY to your Cloudflare Worker Gateway. Never talk to Claude/OpenAI/
 * Groq/Gemini directly from the browser — that would expose your API keys.
 */

// 👉 STEP 1: After you deploy the Gateway (Netlify Function or Cloudflare
// Worker — see README), paste its URL here.
// Netlify Functions look like:
//   https://YOUR-SITE-NAME.netlify.app/.netlify/functions/chat
// Cloudflare Workers look like:
//   https://industrcons-gateway.<your-subdomain>.workers.dev/v1/chat
const GATEWAY_URL = "https://long-king-498d.elvinasgarov12.workers.dev/v1/chat";

const IndustrConsAPI = {
  connected: GATEWAY_URL.indexOf("REPLACE-ME") === -1,

  /**
   * Sends a user message to the Gateway and returns the assistant's reply.
   * @param {string} message
   * @param {Array} history - [{role:'user'|'assistant', content:string}, ...]
   * @param {string} lang - 'az' | 'en'
   */
  async sendMessage(message, history = [], lang = "az") {
    if (!this.connected) {
      // Local fallback so the UI is testable before the backend is deployed.
      return this._localFallback(message, lang);
    }

    try {
      const res = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history, lang })
      });

      if (!res.ok) throw new Error("gateway_error_" + res.status);
      const data = await res.json();

      // Expected Gateway response shape:
      // { reply: string, action: null | { module: 'docs'|'cost-estimator'|'jobs'|'academy', url: string } }
      return data;
    } catch (err) {
      console.error("IndustrCons AI gateway error:", err);
      return {
        reply: lang === "az"
          ? "Üzr istəyirik, hazırda cavab vermək mümkün olmadı. Bir az sonra yenidən cəhd edin."
          : "Sorry, I couldn't respond right now. Please try again shortly.",
        action: null
      };
    }
  },

  /**
   * Very small demo router so the frontend is usable stand-alone before
   * the Worker is deployed. This mirrors (in miniature) the real Tool
   * Router that will live in gateway/src/tools/toolRouter.ts
   */
  _localFallback(message, lang) {
    const m = message.toLowerCase();
    const az = lang === "az";

    if (m.includes("ncr") || m.includes("uyğunsuzluq")) {
      return {
        reply: az
          ? "Bunun üçün NCR formu lazımdır. IndustrCons Docs-u açıram."
          : "You'll need an NCR form for that. Opening IndustrCons Docs.",
        action: { module: "docs", url: "https://industrconsdocs.netlify.app/" }
      };
    }
    if (m.includes("beton") || m.includes("concrete") || m.includes("m²") || m.includes("m2")) {
      return {
        reply: az
          ? "Bu iş üçün sizə Concrete Pour Card, Slump Test Form və Risk Assessment lazımdır. Cost Estimator-u açıram ki, miqdarı birlikdə hesablayaq."
          : "For this you'll need a Concrete Pour Card, Slump Test Form and Risk Assessment. Opening the Cost Estimator so we can calculate quantities together.",
        action: { module: "cost-estimator", url: "https://industrconsestimator.netlify.app/" }
      };
    }
    if (m.includes("qa") || m.includes("qc") || m.includes("şablon") || m.includes("template")) {
      return {
        reply: az
          ? "IndustrCons Docs-da uyğun QA/QC şablonunu tapıram."
          : "Looking for the right QA/QC template in IndustrCons Docs.",
        action: { module: "docs", url: "https://industrconsdocs.netlify.app/" }
      };
    }
    if (m.includes("bilik") || m.includes("knowledge") || m.includes("standart") || m.includes("bələdçi") || m.includes("guide")) {
      return {
        reply: az
          ? "IndustrCons Knowledge Center-i açıram."
          : "Opening IndustrCons Knowledge Center.",
        action: { module: "knowledge", url: "https://industrcons-knowledge-center.vercel.app/" }
      };
    }
    return {
      reply: az
        ? "Bu backend hələ qoşulmayıb (demo rejimi), amma normalda buraya AI cavabı gələcək. Cloudflare Worker-i qoşduqdan sonra tam işləyəcək."
        : "The backend isn't connected yet (demo mode) — once your Cloudflare Worker is live, a real AI answer will appear here.",
      action: null
    };
  }
};
