/**
 * library.js
 *
 * Fetches the epub list from the server, renders the book grid,
 * and drives the in-page epub reader.
 *
 * Expected API:
 *   GET  /api/files          → [{ id, title, coverUrl, fileUrl }, …]
 *   GET  /api/files/:id      → raw .epub bytes  (used when fileUrl absent)
 */

// ── DOM refs ────────────────────────────────────────────────────────────────
const libraryView    = document.getElementById("libraryView");
const readerView     = document.getElementById("readerView");
const bookGrid       = document.getElementById("bookGrid");
const emptyState     = document.getElementById("emptyState");
const loadingOverlay = document.getElementById("loadingOverlay");

const backBtn        = document.getElementById("backBtn");
const readerTitle    = document.getElementById("readerTitle");
const readerContent  = document.getElementById("readerContent");
const prevBtn        = document.getElementById("prevBtn");
const nextBtn        = document.getElementById("nextBtn");
const chapterList    = document.getElementById("chapterList");
const currentPageEl  = document.getElementById("currentPage");
const totalPagesEl   = document.getElementById("totalPages");

// ── Reader state ─────────────────────────────────────────────────────────────
let chapters     = [];   // [{ title, html }]
let currentIndex = 0;

// ── Helpers ──────────────────────────────────────────────────────────────────

function showLoading()  { loadingOverlay.classList.remove("hidden"); }
function hideLoading()  { loadingOverlay.classList.add("hidden"); }

function showView(view) {
  libraryView.classList.remove("active");
  readerView.classList.remove("active");
  view.classList.add("active");
  window.scrollTo(0, 0);
}

// ── Library: fetch & render ──────────────────────────────────────────────────

async function loadLibrary() {
  try {
    const res = await fetch("http://localhost:8080/api/files");

    if (!res.ok) {
      console.error(`Failed to load library: ${res.status} ${res.statusText}`);
      showEmptyState();
      return;
    }

    const books = await res.json();

    if (!books || books.length === 0) {
      showEmptyState();
      return;
    }

    renderBookGrid(books);
  } catch (err) {
    console.error("Could not reach server:", err);
    showEmptyState();
  }
}

function showEmptyState() {
  bookGrid.classList.add("hidden");
  emptyState.classList.remove("hidden");
}

function renderBookGrid(books) {
  bookGrid.innerHTML = "";

  books.forEach((book) => {
    const card = createBookCard(book);
    bookGrid.appendChild(card);
  });
}

function createBookCard(book) {
  const card = document.createElement("div");
  card.className = "book-card";
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.setAttribute("aria-label", `Open ${book.title}`);

  const coverWrap = document.createElement("div");
  coverWrap.className = "book-cover-wrap";

  const spine = document.createElement("div");
  spine.className = "book-spine";
  coverWrap.appendChild(spine);

  if (book.coverUrl) {
    const img = document.createElement("img");
    img.src = book.coverUrl;
    img.alt = `Cover of ${book.title}`;
    img.loading = "lazy";
    img.onerror = () => {
      img.replaceWith(buildDefaultCover(book.title));
    };
    coverWrap.appendChild(img);
  } else {
    coverWrap.appendChild(buildDefaultCover(book.title));
  }

  const info = document.createElement("div");
  info.className = "book-info";

  const title = document.createElement("div");
  title.className = "book-title";
  title.textContent = book.title;

  const meta = document.createElement("div");
  meta.className = "book-meta";
  meta.textContent = "epub";

  info.append(title, meta);
  card.append(coverWrap, info);

  const open = () => openBook(book);
  card.addEventListener("click", open);
  card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") open(); });

  return card;
}

function buildDefaultCover(title) {
  const wrap = document.createElement("div");
  wrap.className = "default-cover";
  const text = document.createElement("div");
  text.className = "default-cover-text";
  text.textContent = title;
  wrap.appendChild(text);
  return wrap;
}

// ── Reader: open & parse epub ────────────────────────────────────────────────

async function openBook(book) {
  showLoading();

  try {
    const epubUrl = book.fileUrl || `http://localhost:8080/api/files/${book.id}`;
    const res = await fetch(epubUrl);

    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

    const arrayBuffer = await res.arrayBuffer();
    chapters = await parseEpub(arrayBuffer);

    if (chapters.length === 0) throw new Error("No readable content found in epub.");

    readerTitle.textContent = book.title;
    buildChapterDots();
    renderChapter(0);
    showView(readerView);
  } catch (err) {
    alert(`ERROR: Could not open book — ${err.message}`);
    console.error(err);
  } finally {
    hideLoading();
  }
}

/**
 * Parse an epub ArrayBuffer using JSZip.
 * Returns an array of { title, html } objects ordered by spine.
 */
async function parseEpub(arrayBuffer) {
  const zip     = await JSZip.loadAsync(arrayBuffer);
  const opfPath = await findOpfPath(zip);
  const opfDir  = opfPath.substring(0, opfPath.lastIndexOf("/") + 1);

  const opfText = await zip.file(opfPath).async("string");
  const opfDoc  = new DOMParser().parseFromString(opfText, "application/xml");

  const manifest = {};
  opfDoc.querySelectorAll("manifest item").forEach((item) => {
    manifest[item.getAttribute("id")] = {
      href:      item.getAttribute("href"),
      mediaType: item.getAttribute("media-type"),
    };
  });

  const spineItems = Array.from(opfDoc.querySelectorAll("spine itemref"));

  // Parse all spine items into raw pages first
  const pages = [];
  for (const ref of spineItems) {
    const idref = ref.getAttribute("idref");
    const entry = manifest[idref];
    if (!entry) continue;
    if (!entry.mediaType?.includes("html") && !entry.mediaType?.includes("xhtml")) continue;

    const filePath = opfDir + entry.href;
    const file     = zip.file(filePath) || zip.file(entry.href);
    if (!file) continue;

    const rawHtml = await file.async("string");
    const cleaned = await sanitiseChapterHtml(rawHtml, zip, opfDir);
    const title   = extractChapterTitle(cleaned);

    pages.push({ title, html: cleaned, href: entry.href });
  }

  // Merge inserts into the preceding page.
  // A page is considered a "main" page if it has a meaningful title
  // (h1/h2 with real text) or is the first page.
  const results = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (isMainPage(page, i)) {
      results.push({ title: page.title || `Section ${results.length + 1}`, html: page.html });
    } else if (results.length > 0) {
      // Append to the previous page
      results[results.length - 1].html += page.html;
    } else {
      // No preceding page yet, treat as its own
      results.push({ title: page.title || `Section ${results.length + 1}`, html: page.html });
    }
  }

  return results;
}

function isMainPage(page, index) {
  // First page always stands alone
  if (index === 0) return true;

  // Parse and look for a meaningful heading
  const doc = new DOMParser().parseFromString(page.html, "text/html");
  const heading = doc.querySelector("h1, h2");

  if (!heading) return false;

  const text = heading.textContent.trim().toLowerCase();

  // These are "landmark" pages — keep them separate
  const landmarks = ["contents", "table of contents", "characters", "dedication", "prologue", "epilogue", "introduction", "preface", "about"];
  if (landmarks.some((l) => text.includes(l))) return true;

  // A heading that looks like a chapter marker stands alone
  if (/^(chapter|part|book|section)\b/i.test(text)) return true;

  // No meaningful heading = treat as an insert, merge with previous
  return false;
}

async function findOpfPath(zip) {
  // Read META-INF/container.xml
  const containerFile = zip.file("META-INF/container.xml");
  if (containerFile) {
    const xml  = await containerFile.async("string");
    const doc  = new DOMParser().parseFromString(xml, "application/xml");
    const path = doc.querySelector("rootfile")?.getAttribute("full-path");
    if (path) return path;
  }
  // Fallback: find first .opf in zip
  const opf = Object.keys(zip.files).find((f) => f.endsWith(".opf"));
  if (opf) return opf;
  throw new Error("Could not locate OPF file in epub.");
}

async function sanitiseChapterHtml(raw, zip, opfDir) {
    const doc = new DOMParser().parseFromString(raw, "text/html");
    doc.querySelectorAll("script, style, link").forEach((el) => el.remove());

    const imgs = doc.querySelectorAll("img");
    for (const img of imgs) {
        const src = img.getAttribute("src");
        if (!src || src.startsWith("http") || src.startsWith("blob")) continue;

        // Resolve path variants
        const candidates = [
            opfDir + src,
            src,
            opfDir + src.replace(/^\.\.\//, ""),
            src.replace(/^\.\.\//, ""),
        ];

        let found = null;
        for (const candidate of candidates) {
            const f = zip.file(candidate);
            if (f) { found = f; break; }
        }

        if (!found) {
            console.warn("Could not find image in epub zip:", src, "tried:", candidates);
            continue;
        }

        const blob = await found.async("blob");
        img.src = URL.createObjectURL(blob);
    }

    return doc.body.innerHTML;
}

function extractChapterTitle(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (
    doc.querySelector("h1, h2, h3, title")?.textContent?.trim() || null
  );
}

// ── Reader: rendering & navigation ───────────────────────────────────────────

function renderChapter(index) {
  currentIndex = index;
  readerContent.innerHTML = chapters[index].html;

  // Scroll to top of content
  readerContent.scrollIntoView({ behavior: "smooth", block: "start" });

  // Update nav buttons
  prevBtn.disabled = index === 0;
  nextBtn.disabled = index === chapters.length - 1;

  // Update progress label
  currentPageEl.textContent = index + 1;
  totalPagesEl.textContent  = chapters.length;

  // Update dot highlights
  document.querySelectorAll(".chapter-dot").forEach((dot, i) => {
    dot.classList.toggle("active", i === index);
  });

  // Retrigger page-turn animation
  readerContent.style.animation = "none";
  void readerContent.offsetWidth; // reflow
  readerContent.style.animation  = "";
}

function buildChapterDots() {
  chapterList.innerHTML = "";
  totalPagesEl.textContent = chapters.length;

  // Only render dots when there are a manageable number of chapters
  const MAX_DOTS = 30;
  if (chapters.length <= MAX_DOTS) {
    chapters.forEach((ch, i) => {
      const dot = document.createElement("button");
      dot.className = "chapter-dot";
      dot.title = ch.title;
      dot.setAttribute("aria-label", `Go to ${ch.title}`);
      dot.addEventListener("click", () => renderChapter(i));
      chapterList.appendChild(dot);
    });
  }
}

// ── Event listeners ──────────────────────────────────────────────────────────

backBtn.addEventListener("click", () => {
  showView(libraryView);
  chapters = [];
});

prevBtn.addEventListener("click", () => {
  if (currentIndex > 0) renderChapter(currentIndex - 1);
});

nextBtn.addEventListener("click", () => {
  if (currentIndex < chapters.length - 1) renderChapter(currentIndex + 1);
});

// Keyboard arrow navigation while in reader
document.addEventListener("keydown", (e) => {
  if (!readerView.classList.contains("active")) return;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") {
    if (currentIndex < chapters.length - 1) renderChapter(currentIndex + 1);
  }
  if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
    if (currentIndex > 0) renderChapter(currentIndex - 1);
  }
});

// ── Exports ───────────────────────────────────────────────────────────────────
export { loadLibrary };
