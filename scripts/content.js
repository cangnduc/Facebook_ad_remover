/**
 * Content Script for AdShield Facebook (Jev AI)
 * Detects posts, extracts content, verifies Friends Whitelist, applies Tier 1 local heuristics & Tier 2 Jev AI classification.
 */

(() => {
  // Current active settings in content script
  let userSettings = {
    apiKey: "",
    hideSponsored: true,
    hideSuggested: true,
    hideGroups: false,
    enableJevAI: true,
    hidingMode: "stealth",
    confidenceThreshold: 0.7,
  };

  // Track posts in flight to prevent duplicate queries
  const processingPosts = new Set();

  // Load initial settings
  chrome.storage.sync.get(["settings"], (data) => {
    if (data.settings) {
      userSettings = { ...userSettings, ...data.settings };
    }
    scheduleScan();
  });

  // Listen for setting changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.settings) {
      userSettings = { ...userSettings, ...changes.settings.newValue };
      applyHidingModeToExistingPosts();
      scheduleScan();
    }
  });

  // Multilingual sponsored keywords
  const SPONSORED_KEYWORDS = [
    "sponsored",
    "được tài trợ",
    "publicidad",
    "publicité",
    "gesponsert",
    "patrocinado",
    "sponsorizzato",
    "reklama",
    "reklam",
    "реклама",
    "ممول",
    "赞助内容",
    "贊助",
    "paid partnership",
    "hợp tác có trả phí",
  ];

  const SUGGESTED_KEYWORDS = [
    "suggested for you",
    "gợi ý cho bạn",
    "bài viết được gợi ý",
    "trang được gợi ý",
    "nhóm được gợi ý",
    "suggested post",
    "suggested page",
    "suggested group",
    "sugerido para ti",
    "suggéré pour vous",
    "empfohlen für dich",
    "consigliato per te",
    "reels and short videos",
    "reels và video ngắn",
    "popular across facebook",
    "phổ biến trên facebook",
    "because you follow",
    "vì bạn theo dõi",
    "similar to",
    "tương tự như",
    "posts you may like",
    "bài viết bạn có thể thích",
    "pages you may like",
    "trang bạn có thể thích",
    "follow recommendations",
    "gợi ý theo dõi",
  ];

  const CTA_KEYWORDS = [
    "shop now",
    "learn more",
    "sign up",
    "install now",
    "book now",
    "contact us",
    "send message",
    "get offer",
    "play game",
    "download",
    "mua ngay",
    "tìm hiểu thêm",
    "đăng ký",
    "cài đặt ngay",
    "gửi tin nhắn",
    "nhận ưu đãi",
  ];

  // Helper to generate simple hash string
  function generateFingerprint(author, text) {
    const str = `${(author || "").trim().toLowerCase()}::${(text || "").slice(0, 120).trim().toLowerCase()}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return `post_${Math.abs(hash)}`;
  }

  // Verify that a container is an actual feed post and NOT a comment, menu, or giant wrapper
  function isSafeSinglePost(node) {
    if (!node || node === document.body) return false;
    const role = node.getAttribute("role");
    if (
      role === "feed" ||
      role === "main" ||
      role === "navigation" ||
      role === "banner"
    ) {
      return false;
    }
    // Never hide sidebars or menus
    if (
      node.closest(
        '[role="navigation"], [role="banner"], [role="complementary"], #leftCol, #rightCol',
      )
    ) {
      return false;
    }
    // NEVER target comments or comment replies!
    if (
      node.closest(
        'ul, [aria-label*="comment" i], [aria-label*="bình luận" i], [aria-label*="reply" i], [aria-label*="phản hồi" i]',
      )
    ) {
      return false;
    }
    // Comments are narrow indented bubbles (< 380px), full feed posts are wide (>= 400px)
    if (node.offsetWidth < 380) {
      return false;
    }
    // A single post cannot be taller than 1800px (giant feed stream is 5000px+)
    if (node.offsetHeight > 1800) {
      return false;
    }
    // A single post cannot contain multiple separate articles
    const subArticles = node.querySelectorAll('div[role="article"]');
    if (subArticles.length > 1) {
      return false;
    }
    return true;
  }

  // Normalize text helper: strips zero-width spaces, non-breaking spaces, and collapses whitespace
  function normalizeText(str) {
    if (!str) return "";
    return str
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  // Find the exact single post card by climbing up from any inner element (like the span)
  function findEnclosingPostCard(el) {
    if (!el || el === document.body) return null;

    // If already marked, return it
    const existing = el.closest("[data-adshield-status]");
    if (existing) return existing;

    // Fast path 1: Check closest FeedUnit pagelet (Facebook React feed unit identifier)
    const feedUnit = el.closest('div[data-pagelet^="FeedUnit"]');
    if (feedUnit && feedUnit.offsetHeight < 2200 && feedUnit.offsetWidth > 250) {
      return feedUnit;
    }

    // Fast path 2: Highest enclosing article container (below giant feed wrapper)
    let topArticle = null;
    let currArt = el.closest('div[role="article"]');
    while (currArt) {
      if (currArt.offsetHeight < 2200 && currArt.offsetWidth > 250) {
        topArticle = currArt;
      }
      if (currArt.parentElement) {
        currArt = currArt.parentElement.closest('div[role="article"]');
      } else {
        break;
      }
    }
    if (topArticle) {
      const parentUnit = topArticle.parentElement
        ? topArticle.parentElement.closest('div[data-pagelet^="FeedUnit"]')
        : null;
      if (parentUnit && parentUnit.offsetHeight < 2200 && parentUnit.offsetWidth > 250) {
        return parentUnit;
      }
      return topArticle;
    }

    // Fast path 3: Direct child of role="feed"
    const feed = el.closest('div[role="feed"]');
    if (feed) {
      let curr = el;
      let feedChild = null;
      while (curr && curr !== feed && curr !== document.body) {
        if (curr.parentElement === feed) {
          feedChild = curr;
          break;
        }
        if (
          curr.parentElement &&
          curr.parentElement.parentElement === feed &&
          curr.parentElement.offsetHeight > 2200
        ) {
          feedChild = curr;
          break;
        }
        curr = curr.parentElement;
      }
      if (feedChild && feedChild.offsetHeight > 40 && feedChild.offsetHeight < 2200) {
        return feedChild;
      }
    }

    // Fallback: Walk up DOM tree to locate the enclosing post container
    let curr = el;
    let fallback = null;

    while (curr && curr !== document.body) {
      const role = curr.getAttribute ? curr.getAttribute("role") : null;
      if (role === "feed" || role === "main" || curr.offsetHeight > 2200) {
        break;
      }

      if (
        curr.offsetHeight >= 100 &&
        curr.offsetHeight <= 2000 &&
        curr.offsetWidth >= 250
      ) {
        if (role === "article") {
          fallback = curr;
        } else if (
          curr.getAttribute("data-pagelet") &&
          curr.getAttribute("data-pagelet").startsWith("FeedUnit")
        ) {
          fallback = curr;
        } else if (curr.classList && curr.classList.contains("x1lliihq")) {
          if (!fallback || curr.offsetHeight > fallback.offsetHeight) {
            fallback = curr;
          }
        } else if (!fallback) {
          fallback = curr;
        }
      }

      curr = curr.parentElement;
    }

    if (fallback && isSafeSinglePost(fallback)) {
      return fallback;
    }

    if (
      fallback &&
      fallback.offsetHeight >= 80 &&
      fallback.offsetHeight <= 2200 &&
      fallback.offsetWidth >= 250
    ) {
      return fallback;
    }

    return null;
  }

  // TIER 1A: DIRECT BOTTOM-UP SPAN SCANNER
  // Scans all spans and text nodes in the DOM directly for "Suggested for you" or "Sponsored"
  function scanAndHideDirectMatches() {
    let matchCount = 0;

    // Scan every span, div[dir="auto"], and text container
    const candidateNodes = document.querySelectorAll(
      'span, div[dir="auto"], h3, h4, a[role="link"]',
    );

    for (const el of candidateNodes) {
      // Skip if already inside a hidden, safe, or unresolved container
      if (
        el.hasAttribute("data-adshield-status") ||
        el.closest("[data-adshield-status]")
      ) {
        continue;
      }

      // Skip elements inside comments or sidebars
      if (
        el.closest(
          'ul, [aria-label*="comment" i], [aria-label*="bình luận" i], [aria-label*="reply" i], [aria-label*="phản hồi" i], [role="navigation"], [role="banner"], [role="complementary"], #leftCol, #rightCol',
        )
      ) {
        continue;
      }

      const raw = normalizeText(el.textContent);
      const aria = normalizeText(el.getAttribute("aria-label"));
      const textToTest = raw || aria;

      // Ensure text is non-empty and within typical subheader/label length (< 160 chars)
      if (!textToTest || textToTest.length > 160) continue;

      let matchedType = null;
      let matchedKw = null;

      // 1. Check for "Suggested for you" / Recommendations
      if (userSettings.hideSuggested) {
        for (const kw of SUGGESTED_KEYWORDS) {
          if (textToTest.includes(kw.toLowerCase())) {
            matchedType = "suggested_page";
            matchedKw = kw;
            break;
          }
        }
      }

      // 2. Check for "Sponsored" / Ads
      if (!matchedType && userSettings.hideSponsored) {
        for (const kw of SPONSORED_KEYWORDS) {
          if (textToTest.includes(kw.toLowerCase())) {
            matchedType = "sponsored_ad";
            matchedKw = kw;
            break;
          }
        }
      }

      if (matchedType) {
        const postCard = findEnclosingPostCard(el);
        if (postCard && !postCard.hasAttribute("data-adshield-status")) {
          matchCount++;
          hidePostElement(postCard, matchedType, 1.0, matchedKw.toUpperCase());
          const statKey =
            matchedType === "suggested_page"
              ? "suggestedBlocked"
              : "adsBlocked";
          chrome.runtime.sendMessage({
            action: "INCREMENT_STAT",
            key: statKey,
          });
        } else if (!postCard) {
          // Tag unresolved elements so they are never scanned again
          el.setAttribute("data-adshield-status", "unresolved");
        }
      }
    }

    // Scan explicit ad links (/ads/about or ads_id)
    if (userSettings.hideSponsored) {
      const adLinks = document.querySelectorAll(
        'a[href*="/ads/about"], a[href*="ads_id="], a[href*="/about/ads"]',
      );
      for (const a of adLinks) {
        if (a.closest("[data-adshield-status]")) continue;
        const postCard = findEnclosingPostCard(a);
        if (postCard && !postCard.hasAttribute("data-adshield-status")) {
          matchCount++;
          hidePostElement(postCard, "sponsored_ad", 1.0, "SPONSORED LINK");
          chrome.runtime.sendMessage({
            action: "INCREMENT_STAT",
            key: "adsBlocked",
          });
        }
      }
    }

    // Scan SVGs with aria-label="Sponsored" or "Được tài trợ"
    if (userSettings.hideSponsored) {
      const svgs = document.querySelectorAll('svg[aria-label]');
      for (const svg of svgs) {
        if (svg.closest("[data-adshield-status]")) continue;
        const label = normalizeText(svg.getAttribute("aria-label"));
        if (label === "sponsored" || label === "được tài trợ") {
          const postCard = findEnclosingPostCard(svg);
          if (postCard && !postCard.hasAttribute("data-adshield-status")) {
            matchCount++;
            hidePostElement(postCard, "sponsored_ad", 1.0, "SPONSORED SVG");
            chrome.runtime.sendMessage({
              action: "INCREMENT_STAT",
              key: "adsBlocked",
            });
          }
        }
      }
    }

    return matchCount;
  }

  // TIER 1B: TOP-DOWN FEED UNIT RETRIEVAL (Safely targeting only real feed posts)
  function getAllFeedUnits() {
    const units = new Set();

    document.querySelectorAll('div[role="article"]').forEach((el) => {
      if (el.parentElement && el.parentElement.closest('div[role="article"]')) {
        return;
      }
      if (!isSafeSinglePost(el)) return;

      const author = extractAuthor(el).toLowerCase();
      const ignoredUI = [
        "create a post",
        "tạo bài viết",
        "facebook menu",
        "menu facebook",
        "stories",
        "tin",
      ];
      if (ignoredUI.includes(author)) return;

      units.add(el);
    });

    document.querySelectorAll('div[data-pagelet^="FeedUnit"]').forEach((el) => {
      if (isSafeSinglePost(el)) {
        units.add(el);
      }
    });

    return Array.from(units);
  }

  // Extract author name from post
  function extractAuthor(postElem) {
    const authorElem = postElem.querySelector(
      'h2, h3, h4, strong, a[role="link"][tabindex="0"]',
    );
    if (authorElem) {
      const text = (authorElem.textContent || "").trim().split("\n")[0];
      if (text.length > 1 && text.length < 70) return text;
    }
    return "Facebook User / Page";
  }

  // Extract subheader details
  function extractSubheader(postElem, author) {
    const authorElem = postElem.querySelector(
      'h2, h3, h4, strong, a[role="link"][tabindex="0"]',
    );
    if (!authorElem) return { subtext: "", hasFollowBtn: false };

    let headerParent = authorElem.parentElement;
    for (let i = 0; i < 4 && headerParent && headerParent !== postElem; i++) {
      if (headerParent.querySelectorAll("span").length > 3) {
        break;
      }
      headerParent = headerParent.parentElement || headerParent;
    }

    if (!headerParent) return { subtext: "", hasFollowBtn: false };

    let hasFollowBtn = false;
    const buttons = headerParent.querySelectorAll(
      'div[role="button"], span[role="button"]',
    );
    for (const b of buttons) {
      const bText = (b.textContent || "").trim().toLowerCase();
      if (
        bText === "follow" ||
        bText === "theo dõi" ||
        bText === "join" ||
        bText === "tham gia"
      ) {
        hasFollowBtn = true;
        break;
      }
    }

    const authorLower = (author || "").toLowerCase();
    const candidateNodes = headerParent.querySelectorAll(
      'span, div[dir="auto"]',
    );
    const subtextParts = [];

    for (const node of candidateNodes) {
      const text = (node.textContent || "").trim();
      const lower = text.toLowerCase();
      if (
        lower &&
        lower !== authorLower &&
        !lower.includes(authorLower) &&
        text.length > 2 &&
        text.length < 80
      ) {
        if (!subtextParts.includes(text)) {
          subtextParts.push(text);
        }
      }
    }

    return {
      subtext: subtextParts.join(" · "),
      hasFollowBtn,
    };
  }

  // Tier 1: Check local heuristics on an individual post
  function checkLocalHeuristics(postElem, author) {
    const rawVisible = normalizeText(postElem.innerText || "");
    const headerVisibleText = rawVisible.slice(0, 600);

    for (const kw of SUGGESTED_KEYWORDS) {
      if (headerVisibleText.includes(kw)) {
        return {
          isAd: true,
          type: "suggested_page",
          reason: `Visible text: "${kw}"`,
        };
      }
    }

    for (const kw of SPONSORED_KEYWORDS) {
      if (headerVisibleText.includes(kw)) {
        return {
          isAd: true,
          type: "sponsored_ad",
          reason: `Visible text: "${kw}"`,
        };
      }
    }

    const { subtext, hasFollowBtn } = extractSubheader(postElem, author);
    if (subtext) {
      const lowerSub = subtext.toLowerCase();
      for (const kw of SUGGESTED_KEYWORDS) {
        if (lowerSub.includes(kw)) {
          return {
            isAd: true,
            type: "suggested_page",
            reason: `Subheader: "${kw}"`,
          };
        }
      }
      for (const kw of SPONSORED_KEYWORDS) {
        if (lowerSub.includes(kw)) {
          return {
            isAd: true,
            type: "sponsored_ad",
            reason: `Subheader: "${kw}"`,
          };
        }
      }
    }

    if (hasFollowBtn && userSettings.hideSuggested) {
      return {
        isAd: true,
        type: "suggested_page",
        reason: "Follow button in post header",
      };
    }

    return null;
  }

  // Extract structured post content for Jev AI
  function extractPostMetadata(postElem, author) {
    const text = (postElem.innerText || "").slice(0, 500);

    let cta = "";
    const buttons = postElem.querySelectorAll(
      'div[role="button"], a[role="button"], button',
    );
    for (const btn of buttons) {
      const btnText = (btn.textContent || "").trim().toLowerCase();
      for (const keyword of CTA_KEYWORDS) {
        if (btnText.includes(keyword)) {
          cta = btnText;
          break;
        }
      }
      if (cta) break;
    }

    let hasExternalLink = false;
    const links = postElem.querySelectorAll("a[href]");
    for (const a of links) {
      const href = a.getAttribute("href") || "";
      if (
        href.includes("l.facebook.com/l.php") ||
        (href.startsWith("http") && !href.includes("facebook.com"))
      ) {
        hasExternalLink = true;
        break;
      }
    }

    const { subtext } = extractSubheader(postElem, author);

    return {
      author,
      text,
      cta,
      hasExternalLink,
      subtext: subtext || "",
    };
  }

  // Apply visual hiding or banner based on user's mode
  function hidePostElement(postElem, category, confidence, tagLabel) {
    postElem.setAttribute("data-adshield-status", "hidden");
    postElem.setAttribute("data-adshield-category", category);
    postElem.setAttribute("data-adshield-tag", tagLabel);

    const prevBanner = postElem.previousElementSibling;
    if (prevBanner && prevBanner.classList.contains("jev-ad-banner")) {
      prevBanner.remove();
    }

    if (userSettings.hidingMode === "stealth") {
      postElem.classList.remove("jev-hidden-collapsed");
      postElem.classList.add("jev-hidden-stealth");
      postElem.style.setProperty("display", "none", "important");
    } else {
      postElem.classList.remove("jev-hidden-stealth");
      postElem.classList.add("jev-hidden-collapsed");
      postElem.style.setProperty("display", "none", "important");

      const banner = document.createElement("div");
      banner.className = "jev-ad-banner";

      const title =
        category === "suggested_page"
          ? "Suggested Content Hidden"
          : "Sponsored Ad Hidden";
      const tagClass = tagLabel.includes("AI")
        ? "jev-tag-ai"
        : "jev-tag-heuristic";

      banner.innerHTML = `
        <div class="jev-ad-banner-left">
          <div class="jev-ad-banner-icon">🛡️</div>
          <span class="jev-ad-banner-text">${title}</span>
          <span class="jev-ad-banner-tag ${tagClass}">${tagLabel}</span>
        </div>
        <button class="jev-ad-banner-unhide-btn" type="button">Show Post</button>
      `;

      const unhideBtn = banner.querySelector(".jev-ad-banner-unhide-btn");
      unhideBtn.addEventListener("click", () => {
        postElem.classList.remove("jev-hidden-collapsed");
        postElem.classList.remove("jev-hidden-stealth");
        postElem.style.removeProperty("display");
        banner.remove();
      });

      postElem.parentNode.insertBefore(banner, postElem);
    }
  }

  // Re-apply hiding styles if user changes mode in settings
  function applyHidingModeToExistingPosts() {
    const hiddenPosts = document.querySelectorAll(
      '[data-adshield-status="hidden"]',
    );
    hiddenPosts.forEach((postElem) => {
      const category =
        postElem.getAttribute("data-adshield-category") || "sponsored_ad";
      const tagLabel = postElem.getAttribute("data-adshield-tag") || "AD";
      hidePostElement(postElem, category, 1.0, tagLabel);
    });
  }

  // Process an individual post unit
  async function processPost(postElem) {
    if (postElem.hasAttribute("data-adshield-status")) return;

    const author = extractAuthor(postElem);
    const firstLine = (postElem.innerText || "").slice(0, 80);
    const currentPostId = `${author}__${firstLine}`;

    if (postElem.getAttribute("data-adshield-post-id") === currentPostId) {
      return;
    }
    postElem.setAttribute("data-adshield-post-id", currentPostId);

    // Tier 1: Check local heuristics for obvious ads and suggested posts
    const localMatch = checkLocalHeuristics(postElem, author);
    if (localMatch) {
      if (localMatch.type === "sponsored_ad" && userSettings.hideSponsored) {
        hidePostElement(postElem, "sponsored_ad", 1.0, "HEURISTIC");
        chrome.runtime.sendMessage({
          action: "INCREMENT_STAT",
          key: "adsBlocked",
        });
        return;
      }
      if (localMatch.type === "suggested_page" && userSettings.hideSuggested) {
        hidePostElement(postElem, "suggested_page", 1.0, "SUGGESTED");
        chrome.runtime.sendMessage({
          action: "INCREMENT_STAT",
          key: "suggestedBlocked",
        });
        return;
      }
    }

    // Tier 2: Jev AI Classification (for ambiguous/disguised posts)
    if (!userSettings.enableJevAI) {
      postElem.setAttribute("data-adshield-status", "safe");
      return;
    }

    const metadata = extractPostMetadata(postElem, author);
    if (!metadata.text || metadata.text.length < 15) {
      return;
    }

    const fingerprint = generateFingerprint(metadata.author, metadata.text);
    if (processingPosts.has(fingerprint)) return;
    processingPosts.add(fingerprint);

    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            action: "CLASSIFY_POST",
            payload: { ...metadata, fingerprint },
          },
          resolve,
        );
      });

      if (!response || !response.success || !response.result) {
        postElem.setAttribute("data-adshield-status", "safe");
        return;
      }

      const { choice, confidence } = response.result;
      const confPct = Math.round((confidence || 0.9) * 100);
      const tagText = response.fromCache
        ? `JEV AI (${confPct}%) • CACHED`
        : `JEV AI (${confPct}%)`;

      if (
        choice === "sponsored_ad" &&
        userSettings.hideSponsored &&
        confidence >= userSettings.confidenceThreshold
      ) {
        hidePostElement(postElem, "sponsored_ad", confidence, tagText);
        if (!response.fromCache) {
          chrome.runtime.sendMessage({
            action: "INCREMENT_STAT",
            key: "adsBlocked",
          });
        }
      } else if (
        choice === "suggested_page" &&
        userSettings.hideSuggested &&
        confidence >= userSettings.confidenceThreshold
      ) {
        hidePostElement(postElem, "suggested_page", confidence, tagText);
        if (!response.fromCache) {
          chrome.runtime.sendMessage({
            action: "INCREMENT_STAT",
            key: "suggestedBlocked",
          });
        }
      } else if (choice === "group_post" && userSettings.hideGroups) {
        hidePostElement(postElem, "group_post", confidence, "GROUP POST");
      } else {
        postElem.setAttribute("data-adshield-status", "safe");
      }
    } catch (err) {
      console.warn("[AdShield Content] Classification error:", err);
      postElem.setAttribute("data-adshield-status", "safe");
    } finally {
      processingPosts.delete(fingerprint);
    }
  }

  // Scan scheduler
  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      // 1. Direct bottom-up scan for Suggested / Sponsored text
      scanAndHideDirectMatches();

      // 2. Scan all feed units
      const units = getAllFeedUnits();
      if (units.length > 0) {
        for (const unit of units) {
          processPost(unit);
        }
      }
    }, 100);
  }

  // Event Listeners
  const observer = new MutationObserver(() => {
    scheduleScan();
  });

  window.addEventListener("scroll", scheduleScan, { passive: true });
  setInterval(scheduleScan, 1000);

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleScan();
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      observer.observe(document.body, { childList: true, subtree: true });
      scheduleScan();
    });
  }
})();
