// 学習記録はこの端末のブラウザ（localStorage）にだけ保存する
const STORE_KEY = "st-study-progress";

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveProgress(progress) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(progress));
  } catch {
    // 保存できない環境（プライベートモード等）では記録なしで動かす
  }
}

function caseProgress(id) {
  const all = loadProgress();
  return all[id] || { done: false, position: 0, rate: 1 };
}

function updateCaseProgress(id, patch) {
  const all = loadProgress();
  all[id] = { ...caseProgress(id), ...patch };
  saveProgress(all);
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const $ = (id) => document.getElementById(id);
let cases = [];

function renderList() {
  $("bar-title").textContent = "ITストラテジスト";
  $("back").hidden = true;
  $("detail-view").hidden = true;
  $("list-view").hidden = false;
  $("d-audio").pause();

  const doneCount = cases.filter((c) => caseProgress(c.id).done).length;
  $("progress").textContent = `学習済み ${doneCount} / ${cases.length} ケース`;

  $("case-list").replaceChildren(
    ...cases.map((c) => {
      const p = caseProgress(c.id);
      const li = document.createElement("li");
      li.innerHTML = `
        <a href="#/case/${encodeURIComponent(c.id)}">
          <div class="label"></div>
          <div class="name"></div>
          <div class="meta">
            <span>🎧 ${c.audio ? c.duration || "-" : "音声準備中"}</span>
            ${p.done ? '<span class="ok">✓ 学習済み</span>'
              : p.position > 0 ? `<span>続きから ${formatTime(p.position)}</span>` : ""}
          </div>
        </a>`;
      li.querySelector(".label").textContent = c.label;
      li.querySelector(".name").textContent = c.title;
      return li;
    })
  );
}

function renderDetail(id) {
  const c = cases.find((x) => x.id === id);
  if (!c) {
    location.hash = "";
    return;
  }
  const p = caseProgress(id);

  $("bar-title").textContent = c.label;
  $("back").hidden = false;
  $("list-view").hidden = true;
  $("detail-view").hidden = false;
  window.scrollTo(0, 0);

  $("d-title").textContent = c.title;
  $("d-source").textContent = `出典：${c.source}`;
  $("d-diagram").src = c.diagram;
  $("d-diagram-link").href = c.diagram;
  $("d-summary").replaceChildren(
    ...c.summary.map((line) => {
      const li = document.createElement("li");
      li.textContent = line;
      return li;
    })
  );

  const audio = $("d-audio");
  audio.dataset.caseId = id;
  $("d-player").hidden = !c.audio;
  $("d-no-audio").hidden = !!c.audio;
  if (!c.audio) {
    audio.removeAttribute("src");
    audio.load();
    renderDone(p.done);
    return;
  }
  audio.src = c.audio;
  // 前回聴いた位置から再開する
  audio.addEventListener(
    "loadedmetadata",
    () => {
      if (p.position > 0 && p.position < audio.duration - 1) audio.currentTime = p.position;
      audio.playbackRate = p.rate;
    },
    { once: true }
  );
  markRate(p.rate);
  renderDone(p.done);
}

function markRate(rate) {
  document.querySelectorAll(".speeds button").forEach((b) => {
    b.classList.toggle("on", Number(b.dataset.rate) === rate);
  });
}

function renderDone(done) {
  const btn = $("d-done");
  btn.textContent = done ? "✓ 学習済み（タップで取り消し）" : "学習完了にする";
  btn.classList.toggle("is-done", done);
}

function route() {
  const m = location.hash.match(/^#\/case\/(.+)$/);
  if (m) renderDetail(decodeURIComponent(m[1]));
  else renderList();
}

function setupEvents() {
  const audio = $("d-audio");

  $("back").addEventListener("click", () => {
    location.hash = "";
  });

  document.querySelectorAll(".speeds button").forEach((b) => {
    b.addEventListener("click", () => {
      const rate = Number(b.dataset.rate);
      audio.playbackRate = rate;
      markRate(rate);
      updateCaseProgress(audio.dataset.caseId, { rate });
    });
  });

  // 再生位置を数秒おきに保存
  let lastSaved = 0;
  audio.addEventListener("timeupdate", () => {
    if (Math.abs(audio.currentTime - lastSaved) < 5) return;
    lastSaved = audio.currentTime;
    updateCaseProgress(audio.dataset.caseId, { position: audio.currentTime });
  });
  audio.addEventListener("pause", () => {
    updateCaseProgress(audio.dataset.caseId, { position: audio.currentTime });
  });
  audio.addEventListener("ended", () => {
    updateCaseProgress(audio.dataset.caseId, { position: 0 });
  });

  $("d-done").addEventListener("click", () => {
    const id = audio.dataset.caseId;
    const done = !caseProgress(id).done;
    updateCaseProgress(id, { done });
    renderDone(done);
  });

  window.addEventListener("hashchange", route);
}

async function init() {
  setupEvents();
  try {
    const res = await fetch("cases.json", { cache: "no-cache" });
    cases = await res.json();
  } catch {
    $("progress").textContent = "cases.json を読み込めませんでした。";
    return;
  }
  route();
}

init();
