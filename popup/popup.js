/**
 * Popup Script for AdShield Facebook (Jev AI)
 * Handles configuration, toggles, API key persistence, and live analytics.
 */

document.addEventListener("DOMContentLoaded", async () => {
  // DOM Elements
  const statusPill = document.getElementById("status-pill");
  const statusText = document.getElementById("status-text");

  const apiKeyInput = document.getElementById("api-key-input");
  const toggleKeyVisibilityBtn = document.getElementById("toggle-key-visibility");
  const saveKeyBtn = document.getElementById("save-key-btn");
  const keyFeedback = document.getElementById("key-feedback");

  const toggleHideSponsored = document.getElementById("toggle-hide-sponsored");
  const toggleHideSuggested = document.getElementById("toggle-hide-suggested");
  const toggleHideGroups = document.getElementById("toggle-hide-groups");
  const toggleEnableAi = document.getElementById("toggle-enable-ai");

  const scanDelaySlider = document.getElementById("scan-delay-slider");
  const scanDelayValue = document.getElementById("scan-delay-value");

  const btnModeStealth = document.getElementById("btn-mode-stealth");
  const btnModeCollapsed = document.getElementById("btn-mode-collapsed");

  const statAds = document.getElementById("stat-ads");
  const statSuggested = document.getElementById("stat-suggested");
  const statAi = document.getElementById("stat-ai");
  const statCache = document.getElementById("stat-cache");

  const resetStatsBtn = document.getElementById("reset-stats-btn");
  const clearCacheBtn = document.getElementById("clear-cache-btn");

  function updateScanDelayUI(ms) {
    const num = Number(ms) || 100;
    scanDelaySlider.value = num;
    let label = `${num} ms`;
    if (num <= 50) label = `${num} ms (Ultra)`;
    else if (num === 100) label = `${num} ms (Balanced)`;
    else if (num >= 300) label = `${num} ms (Eco)`;
    scanDelayValue.textContent = label;
  }

  // Load Settings
  const { settings } = await chrome.storage.sync.get(["settings"]);
  if (settings) {
    if (settings.apiKey) {
      apiKeyInput.value = settings.apiKey;
    }
    toggleHideSponsored.checked = settings.hideSponsored !== false;
    toggleHideSuggested.checked = settings.hideSuggested !== false;
    toggleHideGroups.checked = Boolean(settings.hideGroups);
    toggleEnableAi.checked = settings.enableJevAI !== false;

    updateScanDelayUI(settings.scanDelay || 100);
    updateHidingModeUI(settings.hidingMode || "stealth");
    updateStatusPill(settings.apiKey, settings.enableJevAI);
  } else {
    updateScanDelayUI(100);
    updateStatusPill("", true);
  }

  // Load Stats
  const { stats } = await chrome.storage.local.get(["stats"]);
  renderStats(stats);

  // Real-time stat updater
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      if (changes.stats) renderStats(changes.stats.newValue);
    }
  });

  function renderStats(currentStats) {
    if (!currentStats) return;
    statAds.textContent = (currentStats.adsBlocked || 0).toLocaleString();
    statSuggested.textContent = (currentStats.suggestedBlocked || 0).toLocaleString();
    statAi.textContent = (currentStats.aiQueries || 0).toLocaleString();
    statCache.textContent = (currentStats.cacheHits || 0).toLocaleString();
  }

  function updateStatusPill(key, aiEnabled) {
    if (key && key.trim().length > 5 && aiEnabled !== false) {
      statusPill.className = "status-pill status-active";
      statusText.textContent = "Jev AI Active";
    } else {
      statusPill.className = "status-pill status-heuristic";
      statusText.textContent = "Heuristics Only";
    }
  }

  function updateHidingModeUI(mode) {
    if (mode === "collapsed") {
      btnModeCollapsed.classList.add("active");
      btnModeStealth.classList.remove("active");
    } else {
      btnModeStealth.classList.add("active");
      btnModeCollapsed.classList.remove("active");
    }
  }

  async function updateSettingField(field, value) {
    const data = await chrome.storage.sync.get(["settings"]);
    const updated = { ...(data.settings || {}), [field]: value };
    await chrome.storage.sync.set({ settings: updated });
    return updated;
  }

  // Save API Key
  saveKeyBtn.addEventListener("click", async () => {
    const rawKey = apiKeyInput.value.trim();
    saveKeyBtn.disabled = true;
    saveKeyBtn.textContent = "Saving...";

    const updated = await updateSettingField("apiKey", rawKey);
    updateStatusPill(updated.apiKey, updated.enableJevAI);

    keyFeedback.textContent = rawKey ? "✓ API Key saved successfully!" : "Key cleared. Running in Heuristic mode.";
    keyFeedback.className = "feedback-msg feedback-success";

    setTimeout(() => {
      saveKeyBtn.disabled = false;
      saveKeyBtn.textContent = "Save";
      keyFeedback.textContent = "";
    }, 2200);
  });

  // Toggle API key visibility
  toggleKeyVisibilityBtn.addEventListener("click", () => {
    if (apiKeyInput.type === "password") {
      apiKeyInput.type = "text";
      toggleKeyVisibilityBtn.textContent = "🙈";
    } else {
      apiKeyInput.type = "password";
      toggleKeyVisibilityBtn.textContent = "👁️";
    }
  });

  // Filter toggles
  toggleHideSponsored.addEventListener("change", (e) => {
    updateSettingField("hideSponsored", e.target.checked);
  });

  toggleHideSuggested.addEventListener("change", (e) => {
    updateSettingField("hideSuggested", e.target.checked);
  });

  toggleHideGroups.addEventListener("change", (e) => {
    updateSettingField("hideGroups", e.target.checked);
  });

  toggleEnableAi.addEventListener("change", async (e) => {
    const updated = await updateSettingField("enableJevAI", e.target.checked);
    updateStatusPill(updated.apiKey, updated.enableJevAI);
  });

  // Hiding Mode selection
  btnModeStealth.addEventListener("click", () => {
    updateHidingModeUI("stealth");
    updateSettingField("hidingMode", "stealth");
  });

  btnModeCollapsed.addEventListener("click", () => {
    updateHidingModeUI("collapsed");
    updateSettingField("hidingMode", "collapsed");
  });

  // Scan Responsiveness Slider
  scanDelaySlider.addEventListener("input", (e) => {
    updateScanDelayUI(e.target.value);
  });

  scanDelaySlider.addEventListener("change", (e) => {
    updateSettingField("scanDelay", Number(e.target.value));
  });

  // Reset Stats
  resetStatsBtn.addEventListener("click", async () => {
    const freshStats = { adsBlocked: 0, suggestedBlocked: 0, aiQueries: 0, cacheHits: 0 };
    await chrome.storage.local.set({ stats: freshStats });
    renderStats(freshStats);
  });

  // Clear Cache
  clearCacheBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "CLEAR_CACHE" }, (res) => {
      if (res && res.success) {
        clearCacheBtn.textContent = "Cleared!";
        setTimeout(() => {
          clearCacheBtn.textContent = "Clear Cache";
        }, 1500);
      }
    });
  });
});
