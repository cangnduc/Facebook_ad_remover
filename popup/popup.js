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
  const togglePrioritizeFriends = document.getElementById("toggle-prioritize-friends");

  const friendsCountPill = document.getElementById("friends-count-pill");
  const syncFriendsBtn = document.getElementById("sync-friends-btn");
  const toggleEditFriendsBtn = document.getElementById("toggle-edit-friends-btn");
  const friendsEditContainer = document.getElementById("friends-edit-container");
  const friendsTextarea = document.getElementById("friends-textarea");
  const saveFriendsBtn = document.getElementById("save-friends-btn");
  const friendsSaveFeedback = document.getElementById("friends-save-feedback");

  const btnModeStealth = document.getElementById("btn-mode-stealth");
  const btnModeCollapsed = document.getElementById("btn-mode-collapsed");

  const statAds = document.getElementById("stat-ads");
  const statSuggested = document.getElementById("stat-suggested");
  const statAi = document.getElementById("stat-ai");
  const statCache = document.getElementById("stat-cache");

  const resetStatsBtn = document.getElementById("reset-stats-btn");
  const clearCacheBtn = document.getElementById("clear-cache-btn");

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
    togglePrioritizeFriends.checked = Boolean(settings.prioritizeFriendsOnly);

    updateHidingModeUI(settings.hidingMode || "stealth");
    updateStatusPill(settings.apiKey, settings.enableJevAI);
  } else {
    updateStatusPill("", true);
  }

  // Load Friends List
  const { friendsList } = await chrome.storage.local.get(["friendsList"]);
  renderFriendsCount(friendsList || []);

  function renderFriendsCount(list) {
    const count = Array.isArray(list) ? list.length : 0;
    friendsCountPill.textContent = `${count} Friends`;
  }

  // Handle Sync Friends button (navigates to Facebook friends page)
  syncFriendsBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://www.facebook.com/me/friends" });
  });

  // Handle Edit Friends list toggle
  toggleEditFriendsBtn.addEventListener("click", async () => {
    if (friendsEditContainer.style.display === "none") {
      const data = await chrome.storage.local.get(["friendsList"]);
      const list = data.friendsList || [];
      friendsTextarea.value = list.join("\n");
      friendsEditContainer.style.display = "flex";
      toggleEditFriendsBtn.textContent = "▲ Close";
    } else {
      friendsEditContainer.style.display = "none";
      toggleEditFriendsBtn.textContent = "✏️ Edit List";
    }
  });

  // Handle Save Friends manual list
  saveFriendsBtn.addEventListener("click", async () => {
    const lines = friendsTextarea.value
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 1);

    // De-duplicate
    const unique = Array.from(new Set(lines));
    await chrome.storage.local.set({ friendsList: unique });
    renderFriendsCount(unique);

    friendsSaveFeedback.textContent = `✓ Saved ${unique.length} friends!`;
    friendsSaveFeedback.className = "feedback-msg feedback-success";

    setTimeout(() => {
      friendsSaveFeedback.textContent = "";
    }, 2000);
  });

  // Handle Prioritize Friends toggle
  togglePrioritizeFriends.addEventListener("change", (e) => {
    updateSettingField("prioritizeFriendsOnly", e.target.checked);
  });

  // Load Stats
  const { stats } = await chrome.storage.local.get(["stats"]);
  renderStats(stats);

  // Real-time stat updater
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      if (changes.stats) renderStats(changes.stats.newValue);
      if (changes.friendsList) renderFriendsCount(changes.friendsList.newValue);
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
