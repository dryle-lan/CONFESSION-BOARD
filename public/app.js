// =============================================
// CONFESSIONAL — Client JS
// =============================================

// ── Config ─────────────────────────────────────────────────────────────────────
const API_BASE  = "/api";
const VOTE_KEY  = "confessional_votes_v1"; // localStorage key

// ── State ──────────────────────────────────────────────────────────────────────
let currentSort    = "newest";
let isSubmitting   = false;
let confessions    = [];

// ── DOM Refs ───────────────────────────────────────────────────────────────────
const confessToggle    = document.getElementById("confessToggle");
const confessForm      = document.getElementById("confessForm");
const confessionForm   = document.getElementById("confessionForm");
const titleInput       = document.getElementById("confTitle");
const bodyInput        = document.getElementById("confBody");
const titleCounter     = document.getElementById("titleCounter");
const bodyCounter      = document.getElementById("bodyCounter");
const submitBtn        = document.getElementById("submitBtn");
const formMessage      = document.getElementById("formMessage");
const feedLoading      = document.getElementById("feedLoading");
const feedEmpty        = document.getElementById("feedEmpty");
const confessionList   = document.getElementById("confessionList");
const feedCount        = document.getElementById("feedCount");
const sortTabs         = document.querySelectorAll(".sort-tab");
const template         = document.getElementById("confessionTemplate");

// ── Helpers ────────────────────────────────────────────────────────────────────

function getVotes() {
  try {
    return JSON.parse(localStorage.getItem(VOTE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveVote(confessionId, voteType) {
  const votes = getVotes();
  votes[confessionId] = voteType;
  localStorage.setItem(VOTE_KEY, JSON.stringify(votes));
}

function getMyVote(confessionId) {
  return getVotes()[confessionId] || null;
}

function relativeTime(dateStr) {
  const now  = Date.now();
  const then = new Date(dateStr + (dateStr.endsWith("Z") ? "" : "Z")).getTime();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 10)  return "just now";
  if (diff < 60)  return `${diff}s ago`;
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return `${m}m ago`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return `${h}h ago`;
  }
  if (diff < 604800) {
    const d = Math.floor(diff / 86400);
    return `${d}d ago`;
  }
  return new Date(then).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric"
  });
}

function updateCounter(input, counter, max) {
  const len     = input.value.length;
  const pct     = len / max;
  counter.textContent = `${len} / ${max}`;
  counter.classList.toggle("warning", pct >= 0.8 && pct < 0.95);
  counter.classList.toggle("danger",  pct >= 0.95);
}

function showMessage(type, text) {
  formMessage.textContent  = text;
  formMessage.className    = `form-message ${type}`;
}

function clearMessage() {
  formMessage.className = "form-message";
  formMessage.textContent = "";
}

function setSubmitting(state) {
  isSubmitting = state;
  submitBtn.disabled = state;
  submitBtn.classList.toggle("loading", state);
}

function getSortFromURL() {
  const params = new URLSearchParams(window.location.search);
  const sort   = params.get("sort");
  return sort === "popular" ? "popular" : "newest";
}

function setSortInURL(sort) {
  const url = new URL(window.location.href);
  url.searchParams.set("sort", sort);
  history.replaceState(null, "", url.toString());
}

// ── Form Toggle ────────────────────────────────────────────────────────────────

confessToggle.addEventListener("click", () => {
  const isOpen = confessToggle.getAttribute("aria-expanded") === "true";
  confessToggle.setAttribute("aria-expanded", String(!isOpen));
  confessForm.hidden = isOpen;
  if (!isOpen) titleInput.focus();
});

// ── Character Counters ─────────────────────────────────────────────────────────

titleInput.addEventListener("input", () => updateCounter(titleInput, titleCounter, 100));
bodyInput.addEventListener("input",  () => updateCounter(bodyInput,  bodyCounter,  1000));

// ── Sort Tabs ──────────────────────────────────────────────────────────────────

sortTabs.forEach(tab => {
  tab.addEventListener("click", () => {
    const sort = tab.dataset.sort;
    if (sort === currentSort) return;

    sortTabs.forEach(t => {
      t.classList.toggle("active", t.dataset.sort === sort);
      t.setAttribute("aria-selected", String(t.dataset.sort === sort));
    });

    currentSort = sort;
    setSortInURL(sort);
    loadFeed();
  });
});

// ── Feed ───────────────────────────────────────────────────────────────────────

async function loadFeed() {
  feedLoading.hidden = false;
  feedEmpty.hidden   = true;
  confessionList.innerHTML = "";

  try {
    const res  = await fetch(`${API_BASE}/confessions?sort=${currentSort}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "Failed to load");

    confessions = data.confessions || [];

    feedLoading.hidden = true;

    if (confessions.length === 0) {
      feedEmpty.hidden = false;
    } else {
      feedCount.textContent = `${confessions.length} confession${confessions.length !== 1 ? "s" : ""}`;
      confessions.forEach((c, i) => renderCard(c, i));
    }
  } catch (err) {
    feedLoading.hidden = true;
    confessionList.innerHTML = `
      <p style="font-family:var(--font-mono);font-size:.8rem;color:var(--red);text-align:center;padding:3rem 0;">
        // failed to load feed. try refreshing.
      </p>`;
    console.error("Feed error:", err);
  }
}

function renderCard(confession, index) {
  const clone    = template.content.cloneNode(true);
  const card     = clone.querySelector(".confession-card");
  const myVote   = getMyVote(confession.id);
  const score    = confession.upvotes - confession.downvotes;

  // Stagger animation
  card.style.animationDelay = `${index * 40}ms`;

  card.querySelector(".card-title").textContent  = confession.title;
  card.querySelector(".card-body").textContent   = confession.body;
  card.querySelector(".card-id").textContent     = `#${String(confession.id).padStart(4, "0")}`;

  // Time
  const timeEl       = card.querySelector(".card-time");
  timeEl.textContent = relativeTime(confession.created_at);
  timeEl.setAttribute("datetime", confession.created_at);
  timeEl.title       = new Date(confession.created_at + "Z").toLocaleString();

  // Vote counts
  card.querySelector(".upvote-count").textContent   = confession.upvotes;
  card.querySelector(".downvote-count").textContent = confession.downvotes;

  // Score
  const scoreEl       = card.querySelector(".vote-score");
  scoreEl.textContent = score > 0 ? `+${score}` : String(score);
  scoreEl.classList.toggle("positive", score > 0);
  scoreEl.classList.toggle("negative", score < 0);

  // Voted state
  const upBtn   = card.querySelector(".upvote");
  const downBtn = card.querySelector(".downvote");

  if (myVote === "up")   upBtn.classList.add("voted-up");
  if (myVote === "down") downBtn.classList.add("voted-down");

  // Vote handlers
  [upBtn, downBtn].forEach(btn => {
    btn.addEventListener("click", () => handleVote(confession.id, btn.dataset.type, card));
  });

  confessionList.appendChild(clone);
}

// ── Voting ─────────────────────────────────────────────────────────────────────

async function handleVote(confessionId, voteType, card) {
  const myVote  = getMyVote(confessionId);
  if (myVote === voteType) return; // already voted same

  const upBtn   = card.querySelector(".upvote");
  const downBtn = card.querySelector(".downvote");
  const scoreEl = card.querySelector(".vote-score");

  upBtn.disabled   = true;
  downBtn.disabled = true;

  // Animate the clicked button
  const clicked = voteType === "up" ? upBtn : downBtn;
  clicked.classList.add("pulse");
  clicked.addEventListener("animationend", () => clicked.classList.remove("pulse"), { once: true });

  try {
    const res  = await fetch(`${API_BASE}/confessions/${confessionId}/vote`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ vote: voteType }),
    });

    const data = await res.json();

    if (!res.ok) {
      // 409 = already voted (shouldn't normally hit this with localStorage guard)
      console.warn("Vote error:", data.error);
      return;
    }

    // Update UI with server counts
    card.querySelector(".upvote-count").textContent   = data.upvotes;
    card.querySelector(".downvote-count").textContent = data.downvotes;

    const score       = data.upvotes - data.downvotes;
    scoreEl.textContent = score > 0 ? `+${score}` : String(score);
    scoreEl.classList.toggle("positive", score > 0);
    scoreEl.classList.toggle("negative", score < 0);

    // Update voted state classes
    upBtn.classList.remove("voted-up");
    downBtn.classList.remove("voted-down");

    if (voteType === "up")   upBtn.classList.add("voted-up");
    if (voteType === "down") downBtn.classList.add("voted-down");

    saveVote(confessionId, voteType);

  } catch (err) {
    console.error("Vote failed:", err);
  } finally {
    upBtn.disabled   = false;
    downBtn.disabled = false;
  }
}

// ── Form Submission ────────────────────────────────────────────────────────────

confessionForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (isSubmitting) return;

  clearMessage();

  const title = titleInput.value.trim();
  const body  = bodyInput.value.trim();

  if (!title) { showMessage("error", "// title cannot be empty"); titleInput.focus(); return; }
  if (!body)  { showMessage("error", "// confession cannot be empty"); bodyInput.focus(); return; }
  if (title.length > 100)  { showMessage("error", "// title too long (max 100 chars)"); return; }
  if (body.length  > 1000) { showMessage("error", "// confession too long (max 1000 chars)"); return; }

  setSubmitting(true);

  try {
    const res  = await fetch(`${API_BASE}/confessions`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ title, body }),
    });

    const data = await res.json();

    if (!res.ok) {
      showMessage("error", `// ${data.error || "submission failed"}`);
      return;
    }

    // Success
    confessionForm.reset();
    updateCounter(titleInput, titleCounter, 100);
    updateCounter(bodyInput,  bodyCounter,  1000);

    showMessage("success", "// transmitted. your confession is live.");

    // Collapse form
    setTimeout(() => {
      confessToggle.setAttribute("aria-expanded", "false");
      confessForm.hidden = true;
      clearMessage();
    }, 2200);

    // If sorted by newest, prepend new card; otherwise reload
    if (currentSort === "newest" && data.confession) {
      const newCard = data.confession;
      confessionList.insertAdjacentHTML("afterbegin", "");
      renderCard(newCard, 0);
      confessionList.firstElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      const count = confessionList.querySelectorAll(".confession-card").length;
      feedCount.textContent = `${count} confession${count !== 1 ? "s" : ""}`;
      feedEmpty.hidden = true;
    } else {
      await loadFeed();
    }

  } catch (err) {
    showMessage("error", "// network error. check your connection.");
    console.error("Submit error:", err);
  } finally {
    setSubmitting(false);
  }
});

// ── Update Timestamps ──────────────────────────────────────────────────────────
// Refresh relative timestamps every minute
setInterval(() => {
  document.querySelectorAll(".card-time").forEach(el => {
    const iso = el.getAttribute("datetime");
    if (iso) el.textContent = relativeTime(iso);
  });
}, 60_000);

// ── Init ───────────────────────────────────────────────────────────────────────

function init() {
  // Read sort from URL
  currentSort = getSortFromURL();

  // Set active tab
  sortTabs.forEach(t => {
    const isActive = t.dataset.sort === currentSort;
    t.classList.toggle("active", isActive);
    t.setAttribute("aria-selected", String(isActive));
  });

  loadFeed();
}

init();
