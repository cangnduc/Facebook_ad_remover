# AdShield FB — Smart Facebook Ad & Recommendation Remover

A high-performance Manifest V3 Google Chrome extension designed to cleanly remove sponsored ads, algorithmic "Suggested for you" posts, and promotional clutter from your Facebook feed in real-time.

AdShield operates through a **two-tier hybrid classification engine**:
1. **Tier 1 (Instant Local Heuristics & Direct Span Scanner):** Zero-latency (0ms) DOM matching that identifies and collapses obvious ads, recommendations, reels, and sponsored links locally at zero token cost.
2. **Tier 2 (TypeSafe Jev AI Decision Engine):** A sub-500ms decision model (`jev-latest`) ready for deep classification of disguised, obfuscated, or stealth promotional content.

---

## 📖 How It Works Under the Hood

Modern Facebook is a single-page React application that dynamically injects and virtualizes feed items as you scroll. AdShield is engineered specifically around Facebook's DOM mechanics and style architecture (StyleX) to ensure stealthy, lag-free blocking without breaking feed rendering.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        FACEBOOK DOM MUTATION                           │
│               (User scrolls or new content virtualizes)                │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   DEBOUNCED SCAN SCHEDULER (100ms)                     │
│                MutationObserver + Passive Scroll Listener              │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                  ┌─────────────────┴─────────────────┐
                  ▼                                   ▼
┌───────────────────────────────────┐ ┌───────────────────────────────────┐
│       TIER 1A: BOTTOM-UP          │ │        TIER 1B: TOP-DOWN          │
│       DIRECT SPAN SCANNER         │ │        FEED UNIT SCANNER          │
│  - Queries `<span>`, `div` nodes  │ │  - Evaluates `role="article"`     │
│  - Unicode & space normalization  │ │  - Header & subtext inspection    │
│  - Multi-language keyword match   │ │  - "Follow" button detection      │
│  - Ad link & SVG label checks     │ │                                   │
└─────────────────┬─────────────────┘ └─────────────────┬─────────────────┘
                  │                                   │
                  └─────────────────┬─────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│              ENCLOSING POST CARD RESOLVER (`findEnclosingPostCard`)     │
│  - Fast-path 1: `div[data-pagelet^="FeedUnit"]`                         │
│  - Fast-path 2: Topmost `div[role="article"]` (post-sized)              │
│  - Fast-path 3: Direct child under `div[role="feed"]`                   │
│  - Fail-safe: Caps height (< 2200px) so the feed container never blanks│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
               ┌────────────────────┴────────────────────┐
               ▼                                         ▼
┌───────────────────────────────┐     ┌───────────────────────────────────┐
│     LOCAL MATCH CONFIRMED     │     │      AMBIGUOUS / DISGUISED POST   │
│  - Category: Ad or Suggested  │     │      (No direct keyword match)    │
│  - Action: Immediate Collapse │     └─────────────────┬─────────────────┘
└──────────────┬────────────────┘                       │
               │                                        ▼
               │                      ┌───────────────────────────────────┐
               │                      │   TIER 2: TYPESAFE JEV AI ENGINE  │
               │                      │  - Cache check (In-Memory/Storage)│
               │                      │  - POST /v1/systemone (Jev Model) │
               │                      │  - Classify: Ad / Suggested / Safe│
               │                      └─────────────────┬─────────────────┘
               │                                        │
               └────────────────────┬───────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         VISUAL HIDING ENGINE                           │
│  • Stealth Mode: `display: none !important` (Seamless zero-gap feed)   │
│  • Collapsed Mode: Sleek glassmorphic banner with "Show Post" toggle   │
│  • Live Statistics Sync: Real-time counter updates in popup dashboard   │
└────────────────────────────────────────────────────────────────────────┘
```

---

### Detailed Step-by-Step Breakdown

#### 1. Passive & Event-Driven Feed Monitoring
- **`MutationObserver`**: Observes `document.body` for subtree child-list changes as Facebook dynamically virtualizes new posts into view.
- **Scroll Listener**: Attached with `{ passive: true }` to guarantee zero impact on native scroll performance.
- **Debounced Scheduling**: All triggers pass through a 100ms debounce buffer (`scheduleScan()`) preventing redundant execution and maintaining smooth 60fps feed scrolling.

#### 2. Tier 1A: Bottom-Up Direct `<span>` Scanner
Facebook often scrambles class names (e.g. atomic StyleX utility classes) and nests post contents inside deep div hierarchies. However, textual labels like `"Suggested for you"` or `"Sponsored"` always reside in `<span>` or `div[dir="auto"]` elements.
- **Text Normalization (`normalizeText`)**: Strips invisible zero-width unicode characters (`\u200B`–`\u200D`, `\uFEFF`), converts non-breaking spaces (`\u00A0`) to regular spaces, and collapses whitespace.
- **Multi-Lingual Coverage**: Supports English, Vietnamese (`gợi ý cho bạn`, `bài viết được gợi ý`, `được tài trợ`), Spanish (`sugerido para ti`), French (`suggéré pour vous`), German (`empfohlen für dich`), and more.
- **Ad Link & SVG Inspection**: Scans for embedded ad identifiers such as `a[href*="/ads/about"]`, `a[href*="ads_id="]`, and `svg[aria-label="Sponsored"]`.
- **Fast Skip**: Any element already inside a handled container (`[data-adshield-status]`) is skipped immediately.

#### 3. Post Card Resolution (`findEnclosingPostCard`)
When a matching label is found, AdShield climbs the DOM tree to locate the exact containing post card without selecting the giant outer feed wrapper:
1. **`div[data-pagelet^="FeedUnit"]`**: Facebook’s official React feed item container.
2. **Topmost `div[role="article"]`**: The outermost post card (skips inner reshared cards).
3. **Direct child of `div[role="feed"]`**: Captures non-article suggestion carousels or group recommendations.
4. **Dimensions Guard**: Restricts selection to `height <= 2200px` and `width >= 250px`. This prevents the full feed container from ever being hidden (preventing empty white feed screens).
5. **Unresolved Element Tagging**: Standalone labels (such as navigation badges) that do not map to a feed card are tagged with `data-adshield-status="unresolved"` so they are never re-evaluated.

#### 4. Tier 2: TypeSafe Jev AI Engine (Optional & Future-Ready)
For promotional posts that intentionally avoid explicit labels or use stealth sponsored formats:
- **Feature Extraction**: Extracts author, text content (up to 400 chars), subheaders, call-to-action buttons (`Shop Now`, `Sign Up`), and external link signals.
- **Fingerprinting & Caching**: Generates a deterministic hash `hash(author + text)` to look up results in memory and local storage, eliminating duplicate API calls.
- **Decision Model**: Sends structured criteria to `POST https://api.typesafe.ai/v1/systemone` using TypeSafe's `jev-latest` non-autoregressive decision model.
- **Clean Fallback**: Runs completely free via local heuristics if no API key is configured.

#### 5. Clean Visual Hiding
- **Stealth Mode (Default)**: Completely removes the post container from the document flow (`display: none !important`), leaving behind no blank spaces, margins, or orphaned dividers.
- **Collapsed Mode**: Replaces the blocked item with a compact dark-mode badge displaying the block reason and an **"Show Post"** button to restore the post on demand.

---

## 🚀 Key Features

* **Instant Zero-Latency Filtering**: Removes obvious ads and recommendations locally in 0ms without waiting for network calls.
* **Intelligent Feed Cleanup**: Eliminates "Suggested for you" reels, suggested pages, follow recommendations, and paid partnerships.
* **Quiet & Unobtrusive**: Zero console log spam during daily browsing.
* **Two Hiding Modes**: Choose between seamless removal (Stealth) or interactive badges (Collapsed).
* **Live Statistics Dashboard**: Real-time counter in the popup showing ads blocked, suggestions removed, AI queries, and cache hits.
* **Privacy-First**: Operates locally within your browser. Only ambiguous posts are sent to the AI API if an API key is provided.

---

## 📦 How to Install in Chrome / Edge / Brave

1. Open your Chromium-based browser and navigate to the extensions page:
   * **Chrome**: `chrome://extensions`
   * **Brave**: `brave://extensions`
   * **Edge**: `edge://extensions`
2. Turn on **Developer mode** (toggle in the top-right corner).
3. Click the **"Load unpacked"** button.
4. Select the project directory:
   ```
   d:\Web\Facebook_ad_remover
   ```
5. Pin **AdShield FB** to your browser toolbar for easy access.

---

## ⚙️ Configuration & Popup Dashboard

Click the **AdShield FB** icon in your browser toolbar to access the control panel:
* **TypeSafe Jev API Key**: Paste your key from [console.typesafe.ai](https://console.typesafe.ai) to enable AI scanning (optional).
* **Filter Preferences**:
  * **Hide Sponsored Ads**: Toggle paid marketing and sponsored posts.
  * **Hide "Suggested for you"**: Toggle algorithmic recommendations, pages, and reels.
  * **Filter Group Posts**: Toggle group discussions.
  * **Enable Jev AI Deep Scan**: Toggle AI evaluation on or off.
* **Hiding Style**: Switch between **Stealth (Remove)** and **Collapsed Badge**.
* **Scan Responsiveness**: Interactive slider (50ms – 400ms) to calibrate debounce delay between high-speed reaction and laptop battery saving.
* **Live Statistics**: View total ads blocked, suggestions cut, and clear cache anytime.

---

## 🛠️ Project Structure

```
Facebook_ad_remover/
├── manifest.json              # Chrome Manifest V3 configuration & permissions
├── popup/
│   ├── popup.html             # Sleek dashboard interface
│   ├── popup.css              # Modern dark UI, micro-animations, and badges
│   └── popup.js               # Settings management and live counter updates
├── scripts/
│   ├── background.js          # Service worker: Jev AI API requests & persistent caching
│   ├── content.js             # Feed DOM scanner, post card locator & hiding logic
│   └── content.css            # Styles for collapsed badges and transitions
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── .gitignore                 # Standard clean repository ignore rules
└── README.md                  # Comprehensive architectural documentation
```

---

## 🧪 Testing & Verification

1. Open [https://www.facebook.com](https://www.facebook.com).
2. Scroll through your feed:
   * "Suggested for you" posts, recommended pages, and sponsored ads are automatically and seamlessly hidden.
3. Open the extension popup from your toolbar to view the live counters updating in real-time.
