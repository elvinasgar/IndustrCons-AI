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
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const configNote = document.getElementById("configNote");

  let currentLang = "az";
  let history = [];

  function setStatus() {
    if (IndustrConsAPI.connected) {
      statusDot.classList.add("live");
      statusText.textContent = "canlı";
      configNote.style.display = "none";
    } else {
      statusDot.classList.remove("live");
      statusText.textContent = "demo rejimi";
      configNote.style.display = "block";
    }
  }

  function appendMessage(role, text) {
    const wrap = document.createElement("div");
    wrap.className = "msg " + (role === "user" ? "user" : "bot");

    const label = document.createElement("div");
    label.className = "label";
    label.textContent = role === "user" ? "SİZ" : "INDUSTRCONS AI";

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
    link.textContent = "→ " + moduleLabel(action.module) + " açılsın";
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
      "jobs": "IndustrCons Jobs",
      "academy": "IndustrCons Academy"
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
    typingWrap.innerHTML = '<div class="label">INDUSTRCONS AI</div><div class="bubble">yazır...</div>';
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
      currentLang = btn.dataset.lang;
    });
  });

  setStatus();
})();
