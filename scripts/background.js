/**
 * Background Service Worker for AdShield Facebook (Jev AI)
 * Handles TypeSafe AI (Jev) API calls, caching, rate limiting, and stats synchronization.
 */

const TYPESAFE_API_URL = "https://api.typesafe.ai/v1/systemone";
const MAX_CACHE_ITEMS = 2000;

// In-memory cache for ultra-fast lookups during a single session
const classificationCache = new Map();

// Initialize stats and cache from storage on startup
chrome.runtime.onInstalled.addListener(async () => {
  const defaults = {
    settings: {
      apiKey: "",
      hideSponsored: true,
      hideSuggested: true,
      hideGroups: false,
      enableJevAI: true,
      hidingMode: "stealth", // "stealth" (remove) or "collapsed" (show badge)
      confidenceThreshold: 0.70
    },
    stats: {
      adsBlocked: 0,
      suggestedBlocked: 0,
      aiQueries: 0,
      cacheHits: 0
    }
  };

  const stored = await chrome.storage.sync.get(["settings"]);
  if (!stored.settings) {
    await chrome.storage.sync.set({ settings: defaults.settings });
  }

  const localStored = await chrome.storage.local.get(["stats", "cache"]);
  if (!localStored.stats) {
    await chrome.storage.local.set({ stats: defaults.stats });
  }
  if (localStored.cache && typeof localStored.cache === "object") {
    for (const [k, v] of Object.entries(localStored.cache)) {
      classificationCache.set(k, v);
    }
  }
});

// Load cache into memory when service worker wakes up
(async () => {
  try {
    const data = await chrome.storage.local.get(["cache"]);
    if (data.cache) {
      for (const [k, v] of Object.entries(data.cache)) {
        classificationCache.set(k, v);
      }
    }
  } catch (e) {
    console.warn("[AdShield BG] Failed to hydrate cache:", e);
  }
})();

// Save cached items to local storage periodically or when adding
async function persistCacheItem(key, result) {
  classificationCache.set(key, result);
  // Trim oldest if exceeded
  if (classificationCache.size > MAX_CACHE_ITEMS) {
    const firstKey = classificationCache.keys().next().value;
    classificationCache.delete(firstKey);
  }
  // Async persist
  try {
    const cacheObj = Object.fromEntries(classificationCache);
    await chrome.storage.local.set({ cache: cacheObj });
  } catch (err) {
    console.warn("[AdShield BG] Error saving cache to storage:", err);
  }
}

// Increment statistics in local storage
async function updateStat(key, incrementBy = 1) {
  try {
    const data = await chrome.storage.local.get(["stats"]);
    const stats = data.stats || { adsBlocked: 0, suggestedBlocked: 0, aiQueries: 0, cacheHits: 0 };
    stats[key] = (stats[key] || 0) + incrementBy;
    await chrome.storage.local.set({ stats });
  } catch (err) {
    console.warn("[AdShield BG] Error updating stat:", err);
  }
}

// Call TypeSafe AI's Jev model
async function callJevModel(apiKey, postData) {
  const payload = {
    model: "jev-latest",
    state: {
      author: postData.author || "Unknown",
      text: (postData.text || "").slice(0, 400),
      subtext: postData.subtext || "",
      call_to_action: postData.cta || "None",
      has_external_link: Boolean(postData.hasExternalLink)
    },
    questions: {
      category: {
        type: "choice",
        instructions: "Analyze this Facebook feed post and determine whether it is a paid sponsored ad, a suggested/recommended page, a personal post from a friend, or a community group post.",
        criteria: {
          sponsored_ad: "Paid advertising, commercial promotion, sponsored post, or product sales",
          suggested_page: "Algorithmic recommendation or suggested content page",
          friend_post: "Personal update, photo, or post from a friend",
          group_post: "Community discussion or group post"
        }
      }
    }
  };

  const response = await fetch(TYPESAFE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[AdShield BG ❌ JEV API ERROR]", response.status, errorText);
    throw new Error(`TypeSafe API responded with status ${response.status}: ${errorText}`);
  }

  const json = await response.json();

  // Extract decision from Jev response schema
  let choice = "friend_post";
  let confidence = 0.5;

  if (json.answers && json.answers.category) {
    const cat = json.answers.category;
    choice = cat.selected_choice || cat.choice || cat.value || "friend_post";
    confidence = cat.confidence ?? (cat.probabilities && cat.probabilities[choice] !== undefined ? cat.probabilities[choice] : 0.95);
  } else if (Array.isArray(json.results)) {
    const catResult = json.results.find(r => r.id === "category");
    if (catResult) {
      choice = catResult.choice || catResult.selected_choice || catResult.value;
      confidence = catResult.confidence ?? 0.95;
    }
  }

  return { choice, confidence };
}

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "CLASSIFY_POST") {
    handleClassifyPost(request.payload)
      .then(sendResponse)
      .catch(err => {
        console.error("[AdShield BG] Classify error:", err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep message channel open for async response
  }

  if (request.action === "TEST_API_KEY") {
    testApiKey(request.apiKey)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "INCREMENT_STAT") {
    updateStat(request.key, request.count || 1);
    sendResponse({ success: true });
    return false;
  }

  if (request.action === "CLEAR_CACHE") {
    classificationCache.clear();
    chrome.storage.local.set({ cache: {} }).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
});

async function handleClassifyPost(postData) {
  const cacheKey = postData.fingerprint || `${postData.author}__${(postData.text || "").slice(0, 100)}`;

  // 1. Check in-memory / local cache
  if (classificationCache.has(cacheKey)) {
    await updateStat("cacheHits", 1);
    return {
      success: true,
      result: classificationCache.get(cacheKey),
      fromCache: true
    };
  }

  // 2. Fetch user settings
  const { settings } = await chrome.storage.sync.get(["settings"]);
  if (!settings || !settings.apiKey || !settings.apiKey.trim()) {
    return {
      success: false,
      reason: "NO_API_KEY",
      message: "No TypeSafe API key configured"
    };
  }

  if (settings.enableJevAI === false) {
    return {
      success: false,
      reason: "AI_DISABLED",
      message: "Jev AI is turned off by user"
    };
  }

  // 3. Query TypeSafe Jev API
  try {
    const result = await callJevModel(settings.apiKey.trim(), postData);
    await updateStat("aiQueries", 1);

    // Save in cache
    await persistCacheItem(cacheKey, result);

    return {
      success: true,
      result,
      fromCache: false
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

async function testApiKey(key) {
  if (!key || !key.trim()) {
    throw new Error("API key is empty.");
  }

  const testPayload = {
    model: "jev-latest",
    state: {
      author: "Nike Official Store",
      text: "Flash Sale! Get 40% off running shoes today only. Click to shop.",
      call_to_action: "Shop Now",
      has_external_link: true
    },
    questions: {
      category: {
        type: "choice",
        instructions: "Is this post a sponsored ad?",
        criteria: {
          "sponsored_ad": "Paid ad or promotion",
          "friend_post": "Normal post"
        }
      }
    }
  };

  const response = await fetch(TYPESAFE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key.trim()}`
    },
    body: JSON.stringify(testPayload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API returned HTTP ${response.status}: ${text}`);
  }

  return { success: true };
}
