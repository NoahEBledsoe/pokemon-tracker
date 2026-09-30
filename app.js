const STORAGE_KEY = "pokemon-mini-master-tracker-v1";
const data = window.COLLECTION_DATA;

const state = {
  filter: "all",
  query: "",
  progress: loadProgress(),
  open: new Set(),
};

function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { cards: {} };
    const parsed = JSON.parse(raw);
    return { cards: parsed.cards || {} };
  } catch {
    return { cards: {} };
  }
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, cards: state.progress.cards }));
}

function cardState(id) {
  return state.progress.cards[id] || { owned: false, note: "" };
}

function setOwned(id, owned) {
  const cur = cardState(id);
  state.progress.cards[id] = { ...cur, owned };
  if (!owned && !cur.note) delete state.progress.cards[id];
  saveProgress();
  document.querySelectorAll(`.card-row[data-id="${CSS.escape(id)}"]`).forEach((row) => {
    row.classList.toggle("owned", owned);
    const box = row.querySelector(".check");
    if (box) box.checked = owned;
    if (state.filter === "missing" && owned) row.remove();
    if (state.filter === "owned" && !owned) row.remove();
  });
  updateHero();
  patchSetMeta();
  renderNav();
}

function setNote(id, note) {
  const cur = cardState(id);
  state.progress.cards[id] = { ...cur, note };
  if (!cur.owned && !note) delete state.progress.cards[id];
  saveProgress();
}

function uniqueIds() {
  const ids = new Set();
  for (const era of data.eras) {
    for (const set of era.sets) {
      for (const card of set.cards) ids.add(card.id);
    }
  }
  return ids;
}

function ownedCount(ids) {
  let n = 0;
  for (const id of ids) if (cardState(id).owned) n += 1;
  return n;
}

function setProgress(set) {
  const owned = set.cards.filter((c) => cardState(c.id).owned).length;
  return { owned, total: set.cards.length };
}

function eraProgress(era) {
  const ids = new Set(era.sets.flatMap((s) => s.cards.map((c) => c.id)));
  return { owned: ownedCount(ids), total: ids.size };
}

function matchesQuery(card, q) {
  if (!q) return true;
  const hay = `${card.name} ${card.number} ${card.displayNumber} ${card.setName} ${card.rarity} ${card.note || ""}`.toLowerCase();
  return hay.includes(q);
}

function visibleCard(card) {
  const owned = cardState(card.id).owned;
  if (state.filter === "owned" && !owned) return false;
  if (state.filter === "missing" && owned) return false;
  return matchesQuery(card, state.query);
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 1800);
}

const POCKETS = data.pocketsPerPage || 9;

function setIndex() {
  const map = new Map();
  for (const era of data.eras) {
    for (const set of era.sets) map.set(set.id, { set, era });
  }
  return map;
}

function layoutBinders() {
  const byId = setIndex();
  const home = new Map();
  return data.binders.map((binder) => {
    let page = 1;
    const sections = [];
    for (const sid of binder.setIds) {
      const found = byId.get(sid);
      if (!found) continue;
      const { set, era } = found;
      const fresh = [];
      const rows = set.cards.map((card) => {
        const prior = home.get(card.id);
        if (prior) return { card, housed: prior };
        fresh.push(card);
        return { card };
      });
      let startPage = null;
      let endPage = null;
      if (fresh.length) {
        startPage = page;
        endPage = page + Math.ceil(fresh.length / POCKETS) - 1;
        fresh.forEach((card, i) => {
          home.set(card.id, {
            binderId: binder.id,
            binderNumber: binder.number,
            binderName: binder.name,
            setName: set.name,
            page: startPage + Math.floor(i / POCKETS),
            slot: (i % POCKETS) + 1,
          });
        });
        page = endPage + 1;
      }
      sections.push({
        set,
        era,
        rows: rows.map((row) =>
          row.housed ? row : { card: row.card, placed: home.get(row.card.id) }
        ),
        startPage,
        endPage,
        pockets: fresh.length,
      });
    }
    return { binder, sections, pagesUsed: Math.max(0, page - 1) };
  });
}

const layouts = layoutBinders();

function binderHomes(layout) {
  const ids = [];
  for (const section of layout.sections) {
    for (const row of section.rows) {
      if (!row.housed) ids.push(row.card.id);
    }
  }
  return ids;
}

function renderNav() {
  const nav = document.getElementById("era-nav");
  nav.innerHTML = layouts
    .map((layout) => {
      const ids = binderHomes(layout);
      const owned = ownedCount(ids);
      const pct = ids.length ? Math.round((owned / ids.length) * 100) : 0;
      return `<a href="#binder-${layout.binder.id}">
        <span><em>Binder ${layout.binder.number}</em>${escapeHtml(layout.binder.name)}</span>
        <span class="mini-bar" title="${layout.pagesUsed} of ${data.binderPages} pages"><span style="width:${pct}%"></span></span>
      </a>`;
    })
    .join("");
}

function shopSetName(name) {
  if (name === "Base") return "Base Set";
  return (name || "").replace(/\u2014/g, " ");
}

function collectorNumber(card) {
  const match = String(card.displayNumber || card.number || "").match(/^(\d+)/);
  return match ? Number(match[1]) : 0;
}

const altFullArtIds = (() => {
  const groups = new Map();
  for (const era of data.eras) {
    for (const set of era.sets) {
      for (const card of set.cards) {
        if (card.rarity !== "Rare Ultra") continue;
        const key = `${card.setName}\0${card.name}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(card);
      }
    }
  }
  const ids = new Set();
  for (const cards of groups.values()) {
    if (cards.length < 2) continue;
    let top = cards[0];
    for (const card of cards) {
      if (collectorNumber(card) > collectorNumber(top)) top = card;
    }
    ids.add(top.id);
  }
  return ids;
})();

function shopExtra(card) {
  const id = card.id || "";
  const swshAlt =
    /^swsh\d/.test(id) &&
    !id.startsWith("swsh35") &&
    !id.startsWith("swsh4-") &&
    !id.startsWith("swsh45") &&
    (card.rarity === "Rare Ultra" || card.rarity === "Rare Rainbow");
  if (swshAlt) return /VMAX|VSTAR/i.test(card.name) ? "Alternate Art" : "Alternate Full Art";
  if (altFullArtIds.has(id)) return "Alternate Full Art";
  if (card.rarity === "Rare Rainbow") return "Rainbow Rare";
  return "";
}

function tcgplayerUrl(card) {
  const bits = [card.name];
  const extra = shopExtra(card);
  if (extra) bits.push(extra);
  const number = card.displayNumber || card.number || "";
  if (number && number !== "—") bits.push(number);
  const setName = shopSetName(card.setName);
  if (setName) bits.push(setName);
  const params = new URLSearchParams({
    productLineName: "pokemon",
    q: bits.join(" "),
    view: "grid",
    page: "1",
  });
  return `https://www.tcgplayer.com/search/pokemon/product?${params.toString()}`;
}

function cardRow(card, placement) {
  const st = cardState(card.id);
  const shop = escapeAttr(tcgplayerUrl(card));
  const img = card.image
    ? `<a class="thumb" href="${shop}" target="_blank" rel="noopener noreferrer" title="Prices on TCGPlayer" aria-label="View ${escapeAttr(card.name)} prices on TCGPlayer"><img src="${card.image}" alt="" loading="lazy" width="44" height="60" /></a>`
    : `<div class="ph">No img</div>`;
  const hint = card.note ? `<div class="hint">${escapeHtml(card.note)}</div>` : "";
  const loc = placement.housed
    ? `<div class="loc housed-loc">Binder ${placement.housed.binderNumber} · p.${placement.housed.page}</div>`
    : `<div class="loc">p.${placement.placed.page} · slot ${placement.placed.slot}</div>`;
  return `<div class="card-row ${st.owned ? "owned" : ""} ${placement.housed ? "housed" : ""}" data-id="${card.id}">
    <input class="check" type="checkbox" ${st.owned ? "checked" : ""} aria-label="Owned ${card.name}" />
    ${img}
    <div class="num">${card.displayNumber}${loc}</div>
    <div class="name"><a class="shop" href="${shop}" target="_blank" rel="noopener noreferrer">${escapeHtml(card.name)}</a>${hint}</div>
    <div class="set-name">${escapeHtml(card.setName)}</div>
    <div class="rarity">${escapeHtml(card.rarity || "")}</div>
    <button class="note-btn" type="button" title="Add note / variant / grade">✎</button>
    <div class="note-panel">
      <input type="text" value="${escapeAttr(st.note || "")}" placeholder="Variant, grade, source, notes…" />
    </div>
  </div>`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(s) {
  return escapeHtml(s).replaceAll('"', "&quot;");
}

function renderEras() {
  const root = document.getElementById("eras");
  root.innerHTML = layouts
    .map((layout) => {
      const ids = binderHomes(layout);
      const owned = ownedCount(ids);
      let lastEra = "";
      const setsHtml = layout.sections
        .map((section) => {
          const { set } = section;
          const eraBreak =
            section.era.id !== lastEra
              ? `<div class="era-break"><span>${escapeHtml(section.era.name)}</span><span>${escapeHtml(section.era.years)}</span></div>`
              : "";
          lastEra = section.era.id;
          const vis = section.rows.filter((row) => visibleCard(row.card));
          const p = setProgress(set);
          const pct = p.total ? Math.round((p.owned / p.total) * 100) : 0;
          const open = state.open.has(set.id) || Boolean(state.query);
          const complete = p.owned === p.total && p.total > 0;
          const pageLabel = section.pockets
            ? `pp. ${section.startPage}${section.endPage !== section.startPage ? `–${section.endPage}` : ""}`
            : "no new pockets";
          const rows =
            vis.length === 0
              ? `<div class="empty">No cards match the current filter.</div>`
              : vis.map((row) => cardRow(row.card, row)).join("");
          return `${eraBreak}<section class="set ${set.kind} ${open ? "open" : ""} ${complete ? "complete" : ""}" data-set="${set.id}">
            <button class="set-head" type="button">
              <div>
                <span class="kind">${set.kind === "grails" ? "Grails" : "Mini master"}</span>
                <h3>${escapeHtml(set.name)}</h3>
              </div>
              <div class="set-meta">
                <span class="pages">${pageLabel}</span>
                <span>${p.owned}/${p.total}</span>
                <div class="bar"><span style="width:${pct}%"></span></div>
              </div>
            </button>
            <p class="rationale">${escapeHtml(set.rationale)}</p>
            ${set.blurb ? `<p class="blurb">${escapeHtml(set.blurb)}</p>` : ""}
            <div class="cards">${rows}</div>
          </section>`;
        })
        .join("");
      return `<section class="era binder" id="binder-${layout.binder.id}">
        <div class="era-head">
          <div class="years">Binder ${layout.binder.number} · ${escapeHtml(layout.binder.years)} · ${owned}/${ids.length} cards · ${layout.pagesUsed} / ${data.binderPages} pages</div>
          <h2>${escapeHtml(layout.binder.name)}</h2>
          <p class="era-intro">${escapeHtml(layout.binder.blurb)}</p>
        </div>
        ${setsHtml}
      </section>`;
    })
    .join("");
}

function patchSetMeta() {
  document.querySelectorAll(".set[data-set]").forEach((el) => {
    const set = data.eras.flatMap((e) => e.sets).find((s) => s.id === el.dataset.set);
    if (!set) return;
    const p = setProgress(set);
    const pct = p.total ? Math.round((p.owned / p.total) * 100) : 0;
    el.classList.toggle("complete", p.owned === p.total && p.total > 0);
    const meta = el.querySelector(".set-meta span");
    const bar = el.querySelector(".bar span");
    if (meta) meta.textContent = `${p.owned}/${p.total}`;
    if (bar) bar.style.width = `${pct}%`;
  });
  document.querySelectorAll(".binder").forEach((el) => {
    const layout = layouts.find((item) => `binder-${item.binder.id}` === el.id);
    if (!layout) return;
    const ids = binderHomes(layout);
    const years = el.querySelector(".years");
    if (years) {
      years.textContent = `Binder ${layout.binder.number} · ${layout.binder.years} · ${ownedCount(ids)}/${ids.length} cards · ${layout.pagesUsed} / ${data.binderPages} pages`;
    }
  });
}

function updateHero() {
  const ids = uniqueIds();
  const owned = ownedCount(ids);
  const rawPct = ids.size ? (owned / ids.size) * 100 : 0;
  const pct = Math.round(rawPct);
  document.getElementById("overall-pct").textContent =
    owned > 0 && pct === 0 ? "<1%" : `${pct}%`;
  document.getElementById("owned-count").textContent = owned;
  document.getElementById("unique-count").textContent = ids.size;
  document.getElementById("set-count").textContent = data.stats.sets;
  document.getElementById("era-count").textContent = data.stats.binders;
  const circ = 2 * Math.PI * 52;
  document.querySelector(".ring-fg").style.strokeDashoffset = String(circ * (1 - rawPct / 100));
}

function refresh() {
  renderNav();
  renderEras();
  updateHero();
  bindDynamic();
}

function bindDynamic() {
  document.querySelectorAll(".set-head").forEach((btn) => {
    btn.addEventListener("click", () => {
      const set = btn.closest(".set");
      const id = set.dataset.set;
      set.classList.toggle("open");
      if (set.classList.contains("open")) state.open.add(id);
      else state.open.delete(id);
    });
  });

  document.querySelectorAll(".card-row").forEach((row) => {
    const id = row.dataset.id;
    row.querySelector(".check").addEventListener("change", (e) => {
      setOwned(id, e.target.checked);
    });
    row.querySelector(".note-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      row.classList.toggle("notes-open");
    });
    const input = row.querySelector(".note-panel input");
    input.addEventListener("change", () => setNote(id, input.value.trim()));
    input.addEventListener("click", (e) => e.stopPropagation());
  });
}

function exportProgress() {
  const blob = new Blob([JSON.stringify({ v: 1, exported: new Date().toISOString(), cards: state.progress.cards }, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "pokemon-mini-master-progress.json";
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Progress exported");
}

function importProgress(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed.cards || typeof parsed.cards !== "object") throw new Error("bad file");
      state.progress.cards = parsed.cards;
      saveProgress();
      refresh();
      toast("Progress imported");
    } catch {
      toast("Could not import that file");
    }
  };
  reader.readAsText(file);
}

document.getElementById("search").addEventListener("input", (e) => {
  state.query = e.target.value.trim().toLowerCase();
  refresh();
});

document.querySelectorAll(".chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.filter = btn.dataset.filter;
    refresh();
  });
});

document.getElementById("expand-all").addEventListener("click", () => {
  data.eras.forEach((era) => era.sets.forEach((s) => state.open.add(s.id)));
  refresh();
});

document.getElementById("collapse-all").addEventListener("click", () => {
  state.open.clear();
  state.query = "";
  document.getElementById("search").value = "";
  refresh();
});

document.getElementById("export-btn").addEventListener("click", exportProgress);
document.getElementById("import-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) importProgress(file);
  e.target.value = "";
});

refresh();
