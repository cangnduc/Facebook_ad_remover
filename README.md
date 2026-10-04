# AdShield FB — Smart Facebook Ad Remover (with TypeSafe Jev AI)

A Manifest V3 Google Chrome extension that monitors the Facebook feed in real-time and hides sponsored posts, algorithm suggestions, and unwanted group content using a **two-tier hybrid classification engine**:
1. **Tier 1 (Instant Local Heuristics):** Free, zero-latency DOM signature detection for obvious ads and suggested units.
2. **Tier 2 (TypeSafe Jev AI):** Sub-500ms non-autoregressive decision model (`jev-latest`) for disguised, stealth, or obfuscated posts.

---

## 🚀 Key Features

* **Dual-Engine Filtering:**
  * Catches obvious ads instantly (0ms) without wasting API tokens.
  * Uses TypeSafe Jev AI for ambiguous posts where Facebook obfuscates "Sponsored" tags with scrambled DOM nodes, SVG symbols, or split spans.
* **Smart Feed Categorization:**
  * Separates posts into:
    * 🚫 `sponsored_ad`: Paid marketing and sponsored posts.
    * 💡 `suggested_page`: Algorithmic recommendations & reels.
    * 👥 `group_post`: Community discussions (optional filter).
    * ✅ `friend_post`: Personal updates from friends (always preserved).
* **Two Hiding Modes:**
  * **Stealth Mode:** Completely removes the post container with zero empty space.
  * **Collapsed Mode:** Replaces the ad with a sleek badge showing the classification source and confidence (e.g. `🛡️ Ad Hidden (Jev AI: 94%)`) along with an **"Show Post"** button.
* **Persistent In-Memory & Local Cache:**
  * Posts are fingerprinted (`hash(author + text)`) so scrolling past the same post never triggers duplicate API calls.
* **Works Out of the Box:**
  * Even without an API key, the extension immediately starts blocking ads using local heuristics. You can paste your TypeSafe key at any time in the popup dashboard.

---

## 📦 How to Install in Chrome / Edge / Brave

1. Open your browser and navigate to the extensions manager:
   * Chrome: `chrome://extensions`
   * Brave: `brave://extensions`
   * Edge: `edge://extensions`
2. Enable **Developer mode** (toggle located at the top-right corner).
3. Click the **"Load unpacked"** button.
4. Select the project folder:
   ```
   d:\Web\Facebook_ad_remover
   ```
5. Pin **AdShield FB** to your browser toolbar.

---

## ⚙️ How to Add Your TypeSafe Jev API Key Later

1. Click the **AdShield FB** icon in your browser toolbar.
2. Under **TypeSafe Jev API Key**, paste your API key (obtained from [console.typesafe.ai](https://console.typesafe.ai)).
3. Click **"Save"**.
4. The status badge will switch from **Heuristics Only** (amber) to **Jev AI Active** (green).

---

## 🛠️ Project Structure

```
Facebook_ad_remover/
├── manifest.json              # Chrome Manifest V3 configuration
├── popup/
│   ├── popup.html             # Extension dashboard interface
│   ├── popup.css              # Dark theme styling and micro-interactions
│   └── popup.js               # Settings, storage sync, and live counters
├── scripts/
│   ├── background.js          # Service worker: Jev API requests & caching
│   ├── content.js             # Facebook feed scanner & classification logic
│   └── content.css            # Styles for collapsed badges and transitions
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md                  # Project documentation
```

---

## 🧪 Testing & Verification

1. Open [https://www.facebook.com](https://www.facebook.com).
2. Open Developer Tools (`F12`) → Console tab to see:
   ```
   [AdShield Facebook] Active & Monitoring Feed (Jev AI enabled)
   ```
3. Scroll through your feed:
   * Obvious sponsored posts will be collapsed/hidden instantly.
   * Open the extension popup to watch the live counters (`Ads Blocked`, `Suggested Cut`, `Cache Hits`) update in real time.
