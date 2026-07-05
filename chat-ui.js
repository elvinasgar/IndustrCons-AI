/**
 * IndustrCons AI — Chat UI controller
 * Renders messages, calls IndustrConsAPI, and redirects to modules
 * when the Gateway/Tool Router returns an action.
 */
(function () {
  const chatLog = document.getElementById("chatLog");
  const chatForm = document.getElementById("chatForm");
  const chatInput = document.getElementById("chatInput");
  const sendBtn = document.getElementById("sendBtn");

  let currentLang = "az";
  let history = [];

  // ---- i18n dictionary ----
  const I18N = {
    az: {
      tagline: "TIKINTI ÜÇÜN SÜNİ İNTELLEKT KÖMƏKÇİSİ",
      eyebrow: "Construction Copilot",
      hero_title: "Sahədə lazım olanı saniyələr içində tap.",
      hero_sub: "NCR, QA/QC şablonları, xərc hesablamaları və bilik mərkəzi — hamısı bir yerdə. Aşağıda yazın, IndustrCons AI sizi düzgün alətə yönləndirəcək.",
      mod_docs_title: "IndustrCons Docs",
      mod_docs_sub: "NCR, Risk Assessment, Slump Test və digər formalar. PDF ixracı ilə.",
      mod_est_title: "Cost Estimator",
      mod_est_sub: "Beton, material və əmək xərclərini avtomatik hesabla.",
      mod_kc_title: "Knowledge Center",
      mod_kc_sub: "Tikinti biliyi, standartlar və bələdçilər.",
      go: "AÇ →",
      welcome: 'Salam 👋 Mən IndustrCons AI-yam. Sahədə nə lazımdır? Məsələn: "Sabah beton tökəcəyik" və ya "NCR lazımdır".',
      send: "Göndər",
      whatsapp_link: "WhatsApp Community-ə qoşul",
      contact_label: "Əlaqə",
      placeholder: "Sualınızı yazın..."
    },
    en: {
      tagline: "AI COPILOT FOR CONSTRUCTION",
      eyebrow: "Construction Copilot",
      hero_title: "Find what you need on-site in seconds.",
      hero_sub: "NCR, QA/QC templates, cost calculations and a knowledge center — all in one place. Type below and IndustrCons AI will route you to the right tool.",
      mod_docs_title: "IndustrCons Docs",
      mod_docs_sub: "NCR, Risk Assessment, Slump Test and other forms, with PDF export.",
      mod_est_title: "Cost Estimator",
      mod_est_sub: "Automatically calculate concrete, material and labor costs.",
      mod_kc_title: "Knowledge Center",
      mod_kc_sub: "Construction knowledge, standards and guides.",
      go: "OPEN →",
      welcome: 'Hi 👋 I\'m IndustrCons AI. What do you need on site? For example: "We\'re pouring concrete tomorrow" or "I need an NCR".',
      send: "Send",
      whatsapp_link: "Join the WhatsApp Community",
      contact_label: "Contact",
      placeholder: "Type your question..."
    }
  };

  function applyLanguage(lang) {
    currentLang = lang;
    const dict = I18N[lang];
    document.querySelectorAll("[data-i18n]").forEach(el => {
      const key = el.getAttribute("data-i18n");
      if (dict[key] !== undefined) el.innerHTML = dict[key];
    });
    document.documentElement.lang = lang;
    chatInput.placeholder = dict.placeholder;
  }

  function appendMessage(role, text) {
    const wrap = document.createElement("div");
    wrap.className = "msg " + (role === "user" ? "user" : "bot");

    const label = document.createElement("div");
    label.className = "label";
    label.textContent = role === "user" ? (currentLang === "en" ? "YOU" : "SİZ") : "INDUSTRCONS AI";

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;

    if (role !== "user") wrap.appendChild(label);
    wrap.appendChild(bubble);
    chatLog.appendChild(wrap);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function appendActionCard(action) {
    const wrap = document.createElement("div");
    wrap.className = "msg bot";
    const bubble = document.createElement("div");
    bubble.className = "bubble";

    const link = document.createElement("a");
    link.href = action.url;
    if (action.url.startsWith("http")) {
      link.target = "_blank";
      link.rel = "noopener";
    }
    const openText = currentLang === "en" ? "Open " : "";
    const azText = currentLang === "en" ? "→ " + openText + moduleLabel(action.module) : "→ " + moduleLabel(action.module) + " açılsın";
    link.textContent = azText;
    link.style.color = "#E8622C";
    link.style.fontWeight = "600";
    link.style.textDecoration = "none";

    bubble.appendChild(link);
    wrap.appendChild(bubble);
    chatLog.appendChild(wrap);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function moduleLabel(mod) {
    const labels = {
      "docs": "IndustrCons Docs",
      "cost-estimator": "Cost Estimator",
      "knowledge": "Knowledge Center"
    };
    return labels[mod] || mod;
  }

  chatForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;

    appendMessage("user", text);
    history.push({ role: "user", content: text });
    chatInput.value = "";
    sendBtn.disabled = true;

    const typingWrap = document.createElement("div");
    typingWrap.className = "msg bot";
    typingWrap.id = "typingIndicator";
    const typingText = currentLang === "en" ? "typing..." : "yazır...";
    typingWrap.innerHTML = '<div class="label">INDUSTRCONS AI</div><div class="bubble">' + typingText + '</div>';
    chatLog.appendChild(typingWrap);
    chatLog.scrollTop = chatLog.scrollHeight;

    const result = await IndustrConsAPI.sendMessage(text, history, currentLang);

    document.getElementById("typingIndicator")?.remove();
    appendMessage("bot", result.reply);
    history.push({ role: "assistant", content: result.reply });

    if (result.action) {
      appendActionCard(result.action);
    }

    sendBtn.disabled = false;
    chatInput.focus();
  });

  document.querySelectorAll(".lang-switch button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".lang-switch button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      applyLanguage(btn.dataset.lang);
    });
  });

  applyLanguage("az");
})();
