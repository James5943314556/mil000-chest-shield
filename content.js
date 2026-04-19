(() => {
  const TARGET_PROFILE_USERNAMES = ["mil000"];
  const TARGET_AUTHOR_TERMS = TARGET_PROFILE_USERNAMES.map((username) => `@${username}`);
  const CHEST_IMAGE_URL = chrome.runtime.getURL("assets/fortnite-chest.webp");
  const CHEST_AUDIO_URL = chrome.runtime.getURL("assets/fortnite-chest.mp3");
  const FAHHH_AUDIO_URL = chrome.runtime.getURL("assets/fahhhh.mp3");
  const CHEST_HOVER_VOLUME = 1;
  const CHEST_GAIN = 2;
  const CHEST_START_SECONDS = 0.3;
  const FAHHH_START_SECONDS = 0.3;
  const FAHHH_GAIN = 8;
  const GOLD_BACKGROUND =
    "radial-gradient(circle at 50% 46%, rgb(255, 244, 184) 0, rgb(250, 207, 66) 18%, rgb(238, 174, 24) 36%, rgb(204, 137, 20) 68%, rgb(154, 100, 10) 100%)";
  const GOLD_GLOW_BACKGROUND =
    "radial-gradient(circle at 50% 46%, rgba(255, 244, 184, 0.2) 0, rgba(250, 207, 66, 0.18) 18%, rgba(238, 174, 24, 0.18) 36%, rgba(204, 137, 20, 0.18) 68%, rgba(154, 100, 10, 0.18) 100%)";
  const RESERVED_PROFILE_PATHS = new Set([
    "compose",
    "explore",
    "home",
    "i",
    "messages",
    "notifications",
    "search",
    "settings"
  ]);

  const shieldAudioByOverlay = new WeakMap();
  const articleByChestAudio = new Map();
  const chestAudios = new Set();
  const hoveredChestAudios = new Set();
  const boostedAudioNodes = new WeakMap();
  let audioContext;
  let fahhhBufferPromise;
  let scanQueued = false;
  let lastSeenUrl = window.location.href;

  ensureShieldStyles();

  ["pointerdown", "keydown"].forEach((eventName) => {
    window.addEventListener(eventName, unlockHoverAudio, { capture: true });
  });
  document.addEventListener("pointermove", stopChestAudioOutsidePointer, { capture: true });
  window.addEventListener("blur", stopAllChestAudio);
  window.addEventListener("pagehide", stopAllChestAudio);
  window.addEventListener("beforeunload", stopAllChestAudio);
  window.addEventListener("unload", stopAllChestAudio);
  window.addEventListener("popstate", handleRouteChange);
  window.addEventListener("hashchange", handleRouteChange);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopAllChestAudio();
    }
  });
  patchHistoryRouting();
  window.setInterval(checkForRouteChange, 300);

  const mutationObserver = new MutationObserver(queueScan);
  mutationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  queueScan();

  function queueScan() {
    if (scanQueued) {
      return;
    }

    scanQueued = true;
    window.requestAnimationFrame(() => {
      scanQueued = false;
      scanTweets();
    });
  }

  function scanTweets() {
    document.querySelectorAll("article").forEach(processTweetArticle);
  }

  function processTweetArticle(article) {
    const userNameBlocks = Array.from(article.querySelectorAll('[data-testid="User-Name"]'));
    if (!userNameBlocks.length) {
      cleanupShield(article);
      article.removeAttribute("data-milo-shield-signature");
      return;
    }

    const authorIdentity = getArticleAuthorIdentity(userNameBlocks);
    const tweetId = getTweetId(article);
    const shieldReason = getShieldReason(article, authorIdentity, tweetId);
    const shouldShield = Boolean(shieldReason);
    const signature = `${tweetId || "unknown"}:${authorIdentity.signature}:${shieldReason}`;

    if (article.dataset.miloShieldSignature === signature) {
      return;
    }

    cleanupShield(article);
    article.dataset.miloShieldSignature = signature;

    if (!shouldShield) {
      return;
    }

    addShield(article, tweetId);
  }

  function addShield(article, tweetId) {
    if (article.querySelector(":scope > .milo-tweet-shield")) {
      return;
    }

    article.classList.add("milo-shielded-tweet");
    article.dataset.miloShieldTweetId = tweetId || "";
    applyShieldedTweetStyles(article);

    const overlay = document.createElement("button");
    overlay.type = "button";
    overlay.className = "milo-tweet-shield";
    overlay.setAttribute("aria-label", "Reveal shielded tweet");
    applyShieldOverlayStyles(overlay);

    const glow = document.createElement("span");
    glow.className = "milo-tweet-shield__glow";
    glow.setAttribute("aria-hidden", "true");
    applyGlowStyles(glow);

    const image = document.createElement("img");
    image.className = "milo-tweet-shield__image";
    image.src = CHEST_IMAGE_URL;
    image.alt = "";
    image.decoding = "async";
    applyChestImageStyles(image);

    overlay.append(glow, image);

    const chestAudio = createAudio(CHEST_AUDIO_URL, {
      loop: true,
      volume: CHEST_HOVER_VOLUME
    });
    chestAudio.load();

    shieldAudioByOverlay.set(overlay, chestAudio);
    articleByChestAudio.set(chestAudio, article);
    chestAudios.add(chestAudio);

    overlay.addEventListener("pointerenter", () => startChestAudio(chestAudio));
    overlay.addEventListener("pointerover", () => startChestAudio(chestAudio));
    overlay.addEventListener("mousemove", () => startChestAudio(chestAudio));
    overlay.addEventListener("mouseenter", () => startChestAudio(chestAudio));
    overlay.addEventListener("pointerleave", () => stopChestAudio(chestAudio));
    overlay.addEventListener("mouseleave", () => stopChestAudio(chestAudio));
    article.addEventListener("pointerleave", () => stopChestAudio(chestAudio));
    article.addEventListener("mouseleave", () => stopChestAudio(chestAudio));

    overlay.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      revealTweet(article, overlay, chestAudio, tweetId);
    });

    article.append(overlay);
  }

  function revealTweet(article, overlay, chestAudio, tweetId) {
    pauseAudio(chestAudio);

    playFahhhSound();
    overlay.classList.add("milo-tweet-shield--revealing");

    window.setTimeout(() => {
      overlay.remove();
      article.classList.remove("milo-shielded-tweet");
      clearShieldedTweetStyles(article);
    }, 180);
  }

  function cleanupShield(article) {
    const overlay = article.querySelector(":scope > .milo-tweet-shield");
    if (!overlay) {
      article.classList.remove("milo-shielded-tweet");
      clearShieldedTweetStyles(article);
      return;
    }

    const audio = shieldAudioByOverlay.get(overlay);
    if (audio) {
      pauseAudio(audio);
      articleByChestAudio.delete(audio);
      chestAudios.delete(audio);
      hoveredChestAudios.delete(audio);
    }

    overlay.remove();
    article.classList.remove("milo-shielded-tweet");
    clearShieldedTweetStyles(article);
  }

  function getTweetId(article) {
    const statusLink = Array.from(article.querySelectorAll('a[href*="/status/"]'))
      .map((link) => link.href || link.getAttribute("href") || "")
      .find((href) => /\/status\/\d+/.test(href));

    return statusLink?.match(/\/status\/(\d+)/)?.[1] || "";
  }

  function getArticleAuthorIdentity(userNameBlocks) {
    const identities = userNameBlocks.map(getAuthorIdentity);
    const authorText = identities.map((identity) => identity.authorText).filter(Boolean).join(" ");
    const profileUsernames = [...new Set(identities.flatMap((identity) => identity.profileUsernames))];

    return {
      authorText,
      profileUsernames,
      signature: `${authorText}:${profileUsernames.join(",")}`
    };
  }

  function getAuthorIdentity(userNameBlock) {
    const authorText = normalizeText(userNameBlock.textContent);
    const profileUsernames = Array.from(userNameBlock.querySelectorAll("a[href]"))
      .map((link) => getProfileUsername(link.getAttribute("href") || link.href))
      .filter(Boolean);
    const uniqueProfileUsernames = [...new Set(profileUsernames)];

    return {
      authorText,
      profileUsernames: uniqueProfileUsernames,
      signature: `${authorText}:${uniqueProfileUsernames.join(",")}`
    };
  }

  function getProfileUsername(href) {
    try {
      const url = new URL(href, window.location.origin);
      const host = url.hostname.toLowerCase();
      if (!host.endsWith("x.com") && !host.endsWith("twitter.com")) {
        return "";
      }

      const segments = url.pathname.split("/").filter(Boolean);
      if (!segments.length || segments.includes("status")) {
        return "";
      }

      const username = segments[0].toLowerCase();
      return RESERVED_PROFILE_PATHS.has(username) ? "" : username;
    } catch {
      return "";
    }
  }

  function isTargetAuthor(authorIdentity) {
    return (
      authorIdentity.profileUsernames.some((username) => TARGET_PROFILE_USERNAMES.includes(username)) ||
      TARGET_AUTHOR_TERMS.some((term) => authorIdentity.authorText.includes(term))
    );
  }

  function getShieldReason(article, authorIdentity, tweetId) {
    if (isTargetAuthor(authorIdentity)) {
      return "target-author";
    }

    if (isTargetProfilePage() && isMainTimelineArticle(article) && tweetId) {
      return "target-profile-timeline";
    }

    return "";
  }

  function isTargetProfilePage() {
    const pathUsername = getProfileUsername(window.location.href);
    return TARGET_PROFILE_USERNAMES.includes(pathUsername);
  }

  function isMainTimelineArticle(article) {
    return Boolean(
      article.closest('main[role="main"]') &&
        article.querySelector('a[href*="/status/"]') &&
        !article.closest('[aria-label="Timeline: Trending now"], [aria-label="Who to follow"]')
    );
  }

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function createAudio(src, options = {}) {
    const audio = new Audio(src);
    audio.preload = "auto";
    audio.loop = Boolean(options.loop);
    audio.volume = typeof options.volume === "number" ? options.volume : 1;
    return audio;
  }

  function startChestAudio(audio) {
    stopOtherChestAudio(audio);
    hoveredChestAudios.add(audio);
    if (!audio.paused) {
      return;
    }

    seekAudio(audio, CHEST_START_SECONDS, () => playAudio(audio));
  }

  function stopChestAudio(audio) {
    hoveredChestAudios.delete(audio);
    pauseAudio(audio);
  }

  function stopOtherChestAudio(activeAudio) {
    chestAudios.forEach((audio) => {
      if (audio !== activeAudio) {
        stopChestAudio(audio);
      }
    });
  }

  function stopAllChestAudio() {
    chestAudios.forEach((audio) => stopChestAudio(audio));
  }

  function stopChestAudioOutsidePointer(event) {
    hoveredChestAudios.forEach((audio) => {
      const article = articleByChestAudio.get(audio);
      if (!article || !article.contains(event.target)) {
        stopChestAudio(audio);
      }
    });
  }

  function handleRouteChange() {
    lastSeenUrl = window.location.href;
    stopAllChestAudio();
    queueScan();
  }

  function checkForRouteChange() {
    if (window.location.href === lastSeenUrl) {
      return;
    }

    handleRouteChange();
  }

  function patchHistoryRouting() {
    ["pushState", "replaceState"].forEach((methodName) => {
      const original = history[methodName];
      if (typeof original !== "function" || original.__miloShieldPatched) {
        return;
      }

      const patched = function patchedHistoryMethod(...args) {
        const result = original.apply(this, args);
        handleRouteChange();
        return result;
      };

      patched.__miloShieldPatched = true;
      history[methodName] = patched;
    });
  }

  async function playFahhhSound() {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      playFahhhSoundFallback();
      return;
    }

    try {
      audioContext ||= new AudioContextCtor();
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      fahhhBufferPromise ||= fetch(FAHHH_AUDIO_URL)
        .then((response) => response.arrayBuffer())
        .then((buffer) => audioContext.decodeAudioData(buffer));

      const buffer = await fahhhBufferPromise;
      const source = audioContext.createBufferSource();
      const gain = audioContext.createGain();
      gain.gain.value = FAHHH_GAIN;

      source.buffer = buffer;
      source.connect(gain);
      gain.connect(audioContext.destination);
      source.start(0, Math.min(FAHHH_START_SECONDS, buffer.duration));
    } catch {
      playFahhhSoundFallback();
    }
  }

  function playFahhhSoundFallback() {
    const audio = createAudio(FAHHH_AUDIO_URL, { volume: 1 });
    seekAudio(audio, FAHHH_START_SECONDS, () => audio.play().catch(() => {}));
  }

  function playAudio(audio) {
    prepareBoostedAudio(audio, CHEST_GAIN);
    const result = audio.play();
    if (result && typeof result.catch === "function") {
      result.catch(() => {
        if (hoveredChestAudios.has(audio)) {
          audio.load();
        }
      });
    }
  }

  function prepareBoostedAudio(audio, gainValue) {
    if (gainValue <= 1) {
      return;
    }

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }

    try {
      audioContext ||= new AudioContextCtor();
      if (audioContext.state === "suspended") {
        audioContext.resume().catch(() => {});
      }

      let nodes = boostedAudioNodes.get(audio);
      if (!nodes) {
        const source = audioContext.createMediaElementSource(audio);
        const gain = audioContext.createGain();
        source.connect(gain);
        gain.connect(audioContext.destination);
        nodes = { source, gain };
        boostedAudioNodes.set(audio, nodes);
      }

      nodes.gain.gain.value = gainValue;
    } catch {
      audio.volume = 1;
    }
  }

  function pauseAudio(audio) {
    audio.pause();
    audio.currentTime = 0;
  }

  function seekAudio(audio, seconds, callback) {
    const seek = () => {
      audio.currentTime = seconds;
      callback();
    };

    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      seek();
    } else {
      audio.addEventListener("loadedmetadata", seek, { once: true });
      audio.load();
    }
  }

  function unlockHoverAudio() {
    chestAudios.forEach((audio) => {
      const originalVolume = audio.volume;
      audio.volume = 0;
      prepareBoostedAudio(audio, CHEST_GAIN);

      const result = audio.play();
      const reset = () => {
        audio.pause();
        audio.currentTime = CHEST_START_SECONDS;
        audio.volume = originalVolume;
      };

      if (result && typeof result.then === "function") {
        result
          .then(reset)
          .catch(reset)
          .finally(() => {
            if (hoveredChestAudios.has(audio)) {
              startChestAudio(audio);
            }
          });
      } else {
        reset();
        if (hoveredChestAudios.has(audio)) {
          startChestAudio(audio);
        }
      }
    });
  }

  function ensureShieldStyles() {
    if (document.getElementById("milo-tweet-shield-runtime-styles")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "milo-tweet-shield-runtime-styles";
    style.textContent = `
      .milo-tweet-shield {
        background: ${GOLD_BACKGROUND}, rgb(154, 100, 10) !important;
      }

      .milo-tweet-shield__glow {
        animation: milo-gold-breathe 1450ms ease-in-out infinite !important;
      }

      .milo-tweet-shield__image {
        animation: milo-chest-pulse 1495ms ease-in-out infinite !important;
      }

      .milo-tweet-shield:hover .milo-tweet-shield__image {
        animation-duration: 650ms !important;
      }

      @keyframes milo-gold-breathe {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.08); }
      }

      @keyframes milo-chest-pulse {
        0%, 100% {
          filter: drop-shadow(0 18px 28px rgba(0, 0, 0, 0.72)) drop-shadow(0 0 16px rgba(255, 217, 90, 0.5));
          transform: translateY(0) scale(1);
        }
        50% {
          filter: drop-shadow(0 24px 34px rgba(0, 0, 0, 0.82)) drop-shadow(0 0 40px rgba(255, 217, 90, 1));
          transform: translateY(-5px) scale(1.1);
        }
      }
    `;
    document.documentElement.append(style);
  }

  function applyShieldedTweetStyles(article) {
    if (window.getComputedStyle(article).position !== "static") {
      return;
    }

    article.dataset.miloShieldHadInlinePosition = article.style.position ? "true" : "false";
    article.dataset.miloShieldInlinePosition = article.style.position;
    article.style.setProperty("position", "relative", "important");
  }

  function clearShieldedTweetStyles(article) {
    if (!article.dataset.miloShieldHadInlinePosition) {
      return;
    }

    if (article.dataset.miloShieldHadInlinePosition === "true") {
      article.style.position = article.dataset.miloShieldInlinePosition || "";
    } else {
      article.style.removeProperty("position");
    }

    delete article.dataset.miloShieldHadInlinePosition;
    delete article.dataset.miloShieldInlinePosition;
  }

  function applyShieldOverlayStyles(overlay) {
    overlay.style.setProperty("align-items", "center", "important");
    overlay.style.setProperty("background", `${GOLD_BACKGROUND}, rgb(154, 100, 10)`, "important");
    overlay.style.setProperty("border", "0", "important");
    overlay.style.setProperty("bottom", "0", "important");
    overlay.style.setProperty("box-sizing", "border-box", "important");
    overlay.style.setProperty("color", "#ffffff", "important");
    overlay.style.setProperty("cursor", "pointer", "important");
    overlay.style.setProperty("display", "flex", "important");
    overlay.style.setProperty("flex-direction", "column", "important");
    overlay.style.setProperty("gap", "10px", "important");
    overlay.style.setProperty("justify-content", "center", "important");
    overlay.style.setProperty("left", "0", "important");
    overlay.style.setProperty("overflow", "hidden", "important");
    overlay.style.setProperty("padding", "18px", "important");
    overlay.style.setProperty("position", "absolute", "important");
    overlay.style.setProperty("right", "0", "important");
    overlay.style.setProperty("text-align", "center", "important");
    overlay.style.setProperty("top", "0", "important");
    overlay.style.setProperty("z-index", "2147483647", "important");
  }

  function applyGlowStyles(glow) {
    glow.style.setProperty("background", GOLD_GLOW_BACKGROUND, "important");
    glow.style.setProperty("bottom", "-22%", "important");
    glow.style.setProperty("left", "-14%", "important");
    glow.style.setProperty("position", "absolute", "important");
    glow.style.setProperty("right", "-14%", "important");
    glow.style.setProperty("top", "-22%", "important");
    glow.style.setProperty("z-index", "0", "important");
  }

  function applyChestImageStyles(image) {
    image.style.setProperty("display", "block", "important");
    image.style.setProperty("height", "auto", "important");
    image.style.setProperty("max-height", "calc(100% - 10px)", "important");
    image.style.setProperty("max-width", "72%", "important");
    image.style.setProperty("object-fit", "contain", "important");
    image.style.setProperty("position", "relative", "important");
    image.style.setProperty("transform-origin", "center", "important");
    image.style.setProperty("width", "min(52%, 220px)", "important");
    image.style.setProperty("z-index", "1", "important");
  }

})();
