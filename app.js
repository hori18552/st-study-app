// 学習記録とマーカーはこの端末のブラウザ（localStorage）にだけ保存する
const STORE_KEY = "st-study-progress";
const MARKS_KEY = "st-study-marks";

const TYPE_LABELS = {
  extract: "抜粋",
  rephrase: "抜粋＋言い換え",
  compose: "構成",
};

function loadJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || {};
  } catch {
    return {};
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 保存できない環境（プライベートモード等）では記録なしで動かす
  }
}

function caseProgress(id) {
  return loadJson(STORE_KEY)[id] || { done: false, position: 0, rate: 1 };
}

function updateCaseProgress(id, patch) {
  const all = loadJson(STORE_KEY);
  all[id] = { ...caseProgress(id), ...patch };
  saveJson(STORE_KEY, all);
}

function caseMarks(id) {
  return loadJson(MARKS_KEY)[id] || [];
}

function saveCaseMarks(id, marks) {
  const all = loadJson(MARKS_KEY);
  all[id] = marks;
  saveJson(MARKS_KEY, all);
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const $ = (id) => document.getElementById(id);
let cases = [];
let current = null; // { case, content }
let evidenceMode = "off"; // "off" | "all" | 設問id

// ---------- 一覧 ----------

function renderList() {
  tts.reset();
  $("diagram-viewer").hidden = true;
  document.body.classList.remove("no-scroll");
  current = null;
  $("bar-title").textContent = "ITストラテジスト";
  $("back").hidden = true;
  syncBarHeight();
  $("detail-view").hidden = true;
  $("list-view").hidden = false;
  $("d-audio").pause();
  hideMarkBar();

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

// ---------- 詳細 ----------

async function renderDetail(id, tab) {
  const c = cases.find((x) => x.id === id);
  if (!c) {
    location.hash = "";
    return;
  }
  const p = caseProgress(id);

  $("bar-title").textContent = c.label;
  $("back").hidden = false;
  syncBarHeight();
  $("list-view").hidden = true;
  $("detail-view").hidden = false;

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

  setupAudio(c, p);
  renderDone(p.done);

  if (!current || current.case.id !== id) {
    tts.reset();
    evidenceMode = "off";
    current = { case: c, content: null };
    if (c.content) {
      try {
        const res = await fetch(c.content, { cache: "no-cache" });
        current.content = await res.json();
      } catch {
        current.content = null;
      }
    }
    renderQuestion();
    renderAnswers();
    window.scrollTo(0, 0);
  }
  showTab(tab || "diagram");
}

function setupAudio(c, p) {
  const audio = $("d-audio");
  if (audio.dataset.caseId === c.id) return;
  audio.dataset.caseId = c.id;
  $("d-player").hidden = !c.audio;
  $("d-no-audio").hidden = !!c.audio;
  if (!c.audio) {
    audio.removeAttribute("src");
    audio.load();
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
}

function showTab(tab) {
  document.querySelectorAll(".tabs button").forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on);
  });
  document.querySelectorAll(".tab-panel").forEach((el) => {
    el.hidden = el.id !== `tab-${tab}`;
  });
  hideMarkBar();
  tts.updateButtons();
  if (tts.owner === tab) tts.highlight();
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

// ---------- 問題文とマーカー ----------

function evidenceRanges(paraId) {
  const content = current.content;
  if (evidenceMode === "off") return [];
  const para = findPara(paraId);
  const ranges = [];
  for (const q of content.questions) {
    if (evidenceMode !== "all" && evidenceMode !== q.id) continue;
    for (const ev of q.evidence || []) {
      if (ev.para !== paraId) continue;
      const start = para.text.indexOf(ev.quote);
      if (start < 0) continue;
      ranges.push({ start, end: start + ev.quote.length, kind: "ev", q: q.id, label: q.short || q.label });
    }
  }
  return ranges;
}

function findPara(paraId) {
  for (const s of current.content.sections) {
    const p = s.paras.find((x) => x.id === paraId);
    if (p) return p;
  }
  return null;
}

// 重なったマーカーを、境界ごとに区切った span の並びにする
function buildParaNodes(para) {
  const marks = caseMarks(current.case.id).filter((m) => m.para === para.id);
  const ranges = [...marks, ...evidenceRanges(para.id)];
  const cuts = new Set([0, para.text.length]);
  ranges.forEach((r) => {
    cuts.add(r.start);
    cuts.add(r.end);
  });
  const points = [...cuts].sort((a, b) => a - b);
  const nodes = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const text = para.text.slice(a, b);
    const covering = ranges.filter((r) => r.start <= a && r.end >= b);
    if (!covering.length) {
      nodes.push(document.createTextNode(text));
      continue;
    }
    const span = document.createElement("span");
    span.textContent = text;
    for (const r of covering) {
      if (r.kind === "ev") {
        span.classList.add("ev");
        if (evidenceMode === r.q) span.classList.add("ev-focus");
        if (r.start === a) {
          span.classList.add("ev-start");
          span.dataset.label = r.label;
          span.dataset.q = r.q;
        }
      } else {
        span.classList.add(r.kind === "hl" ? "mk-hl" : "mk-ul");
        span.dataset.markId = r.id;
      }
    }
    nodes.push(span);
  }
  return nodes;
}

function renderQuestion() {
  const box = $("q-text");
  const content = current.content;
  if (!content) {
    box.innerHTML = '<p class="empty">問題文はまだ登録されていません。</p>';
    $("ev-toggle-btn").hidden = true;
    return;
  }
  $("ev-toggle-btn").hidden = false;
  $("ev-toggle-btn").textContent =
    evidenceMode === "off" ? "根拠マーカーを表示" : "根拠マーカーを隠す";

  const frag = document.createDocumentFragment();
  for (const s of content.sections) {
    if (s.heading) {
      const h = document.createElement("h4");
      h.textContent = s.heading;
      h.dataset.para = `h-${s.heading}`;
      frag.append(h);
    }
    for (const para of s.paras) {
      const p = document.createElement("p");
      p.className = `para ${para.kind || ""}`;
      p.dataset.para = para.id;
      p.append(...buildParaNodes(para));
      frag.append(p);
    }
  }
  box.replaceChildren(frag);
}

// 段落の先頭から (node, offset) までの文字数
function offsetIn(paraEl, node, offset) {
  const r = document.createRange();
  r.selectNodeContents(paraEl);
  r.setEnd(node, offset);
  return r.toString().length;
}

function selectionToMarks(range) {
  const result = [];
  $("q-text").querySelectorAll(".para").forEach((el) => {
    if (!range.intersectsNode(el)) return;
    const len = el.textContent.length;
    const start = el.contains(range.startContainer)
      ? offsetIn(el, range.startContainer, range.startOffset) : 0;
    const end = el.contains(range.endContainer)
      ? offsetIn(el, range.endContainer, range.endOffset) : len;
    if (end > start) result.push({ para: el.dataset.para, start, end });
  });
  return result;
}

let pendingRange = null;
let pendingDeleteId = null;

function showMarkBar(mode) {
  const bar = $("mark-bar");
  bar.querySelector('[data-mark="hl"]').hidden = mode !== "add";
  bar.querySelector('[data-mark="ul"]').hidden = mode !== "add";
  bar.querySelector('[data-mark="del"]').hidden = mode !== "del";
  bar.hidden = false;
}

function hideMarkBar() {
  $("mark-bar").hidden = true;
  pendingRange = null;
  pendingDeleteId = null;
}

function setupMarkers() {
  document.addEventListener("selectionchange", () => {
    const sel = document.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!$("q-text").contains(range.commonAncestorContainer)) return;
    pendingRange = range.cloneRange();
    pendingDeleteId = null;
    showMarkBar("add");
  });

  $("q-text").addEventListener("click", (e) => {
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed) return;
    const mark = e.target.closest("[data-mark-id]");
    if (mark) {
      pendingDeleteId = mark.dataset.markId;
      pendingRange = null;
      showMarkBar("del");
    } else if (!$("mark-bar").hidden) {
      hideMarkBar();
    }
  });

  // ボタンを押した瞬間に選択が外れないよう、既定の動作を止める
  $("mark-bar").addEventListener("pointerdown", (e) => e.preventDefault());
  $("mark-bar").addEventListener("click", (e) => {
    const kind = e.target.dataset.mark;
    if (!kind) return;
    const id = current.case.id;
    let marks = caseMarks(id);
    if ((kind === "hl" || kind === "ul") && pendingRange) {
      const stamp = Date.now().toString(36);
      selectionToMarks(pendingRange).forEach((m, i) => {
        marks.push({ id: `${stamp}-${i}`, kind, ...m });
      });
    } else if (kind === "del" && pendingDeleteId) {
      marks = marks.filter((m) => m.id !== pendingDeleteId);
    }
    saveCaseMarks(id, marks);
    document.getSelection().removeAllRanges();
    hideMarkBar();
    renderQuestion();
  });

  $("ev-toggle-btn").addEventListener("click", () => {
    evidenceMode = evidenceMode === "off" ? "all" : "off";
    renderQuestion();
  });
}

// ---------- 設問と解答 ----------

function renderAnswers() {
  const list = $("a-list");
  const content = current.content;
  const intent = $("a-intent");
  if (!content || !content.questions) {
    list.innerHTML = '<p class="empty">設問と解答例はまだ登録されていません。</p>';
    intent.hidden = true;
    return;
  }
  intent.hidden = !content.intent;
  intent.querySelector("p").textContent = content.intent || "";

  list.replaceChildren(
    ...content.questions.map((q) => {
      const card = document.createElement("article");
      card.className = "a-card";
      card.dataset.q = q.id;
      card.innerHTML = `
        <header>
          <span class="a-label"></span>
          <span class="type type-${q.type}">${TYPE_LABELS[q.type] || q.type}</span>
        </header>
        <p class="a-question"></p>
        <button class="a-reveal">解答例を見る</button>
        <div class="a-body" hidden>
          <p class="a-answer"></p>
          <p class="a-point"></p>
        </div>
        <button class="a-evidence">根拠を問題文で見る ›</button>`;
      card.querySelector(".a-label").textContent = q.label;
      card.querySelector(".a-question").textContent = q.text;
      card.querySelector(".a-answer").textContent = q.answer;
      const point = card.querySelector(".a-point");
      point.textContent = q.point || "";
      point.hidden = !q.point;
      card.querySelector(".a-evidence").hidden = !(q.evidence && q.evidence.length);
      return card;
    })
  );
}

function setupAnswers() {
  $("a-list").addEventListener("click", (e) => {
    const card = e.target.closest(".a-card");
    if (!card) return;
    if (e.target.closest(".a-reveal")) {
      const body = card.querySelector(".a-body");
      body.hidden = !body.hidden;
      e.target.textContent = body.hidden ? "解答例を見る" : "解答例を隠す";
    }
    if (e.target.closest(".a-evidence")) {
      evidenceMode = card.dataset.q;
      renderQuestion();
      showTab("question");
      const first = $("q-text").querySelector(".ev-focus");
      if (first) first.scrollIntoView({ block: "center" });
    }
  });
}

// ---------- 読み上げ（ブラウザの音声合成） ----------

const tts = {
  owner: null, // 読み上げ中のタブ（"question" | "answer"）
  queue: [],
  index: 0,
  rate: 1,
  voice: null,
  positions: {}, // タブごとの「続きから」の位置
  token: 0, // 止めた・読み直した発話の終了通知を無視するための番号

  // 速度の設定が素直に効く声を優先する
  pickVoice() {
    const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("ja"));
    const prefs = [/Google/, /Kyoko|O-ren|Otoya/, /Nanami|Keita/, /Haruka|Ayumi|Sayaka|Ichiro/];
    for (const p of prefs) {
      const v = voices.find((x) => p.test(x.name));
      if (v) {
        this.voice = v;
        return;
      }
    }
    this.voice = voices[0] || null;
  },

  play(owner, items, from = 0) {
    this.pause();
    if (!("speechSynthesis" in window)) {
      alert("このブラウザは読み上げに対応していません。");
      return;
    }
    $("d-audio").pause();
    this.owner = owner;
    this.queue = items;
    this.index = from < items.length ? from : 0;
    this.updateButtons();
    this.speakFrom(this.index);
  },

  // 1文ずつ「読み終わったら次」を始めると、文の出だしが切れる声がある。
  // そのため残りの文をまとめて順番待ちに入れ、読み始めの通知で位置を追う。
  speakFrom(from) {
    const token = ++this.token;
    speechSynthesis.cancel();
    // cancel の直後に speak すると無視されるブラウザがあるので、少し待つ
    setTimeout(() => {
      if (token !== this.token || !this.owner) return;
      for (let i = from; i < this.queue.length; i++) {
        const u = new SpeechSynthesisUtterance(this.queue[i].text);
        u.lang = "ja-JP";
        u.rate = this.rate;
        if (this.voice) u.voice = this.voice;
        u.onstart = () => {
          if (token !== this.token) return;
          this.index = i;
          this.positions[this.owner] = i;
          this.highlight();
        };
        if (i === this.queue.length - 1) {
          u.onend = () => {
            if (token !== this.token) return;
            this.positions[this.owner] = 0;
            this.owner = null;
            this.clearHighlight();
            this.updateButtons();
          };
        }
        speechSynthesis.speak(u);
      }
    }, 80);
  },

  highlight() {
    this.clearHighlight();
    const item = this.queue[this.index];
    const el = item && item.find();
    if (!el) return;
    el.classList.add("reading");
    // 別のタブを見ている間は、画面を動かさない
    if (!$(`tab-${this.owner}`).hidden) el.scrollIntoView({ block: "center" });
  },

  clearHighlight() {
    document.querySelectorAll(".reading").forEach((el) => el.classList.remove("reading"));
  },

  // 止めた位置は positions に残し、次は続きから読む
  pause() {
    if (this.owner) this.positions[this.owner] = this.index;
    this.owner = null;
    this.token++;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    this.clearHighlight();
    this.updateButtons();
  },

  // 読んでいる途中なら、今の文から新しい速度で読み直す
  setRate(rate) {
    this.rate = rate;
    this.updateButtons();
    if (this.owner) this.speakFrom(this.index);
  },

  reset() {
    this.pause();
    this.positions = {};
    this.updateButtons();
  },

  updateButtons() {
    document.querySelectorAll(".tts").forEach((box) => {
      const owner = box.dataset.tts;
      const btn = box.querySelector(".tts-play");
      const playing = this.owner === owner;
      const resumable = !playing && (this.positions[owner] || 0) > 0;
      btn.classList.toggle("on", playing);
      btn.textContent = playing
        ? "⏸ 一時停止"
        : resumable ? "▶ 続きから"
        : owner === "question" ? "▶ 問題文を読み上げ" : "▶ 設問と解答を読み上げ";
      box.querySelector(".tts-restart").hidden = !(playing || resumable);
      box.querySelectorAll(".tts-rates button").forEach((b) => {
        b.classList.toggle("on", Number(b.dataset.rate) === this.rate);
      });
    });
    // 読み上げ中のタブの外にいるときだけ、画面下にミニバーを出す
    const away = this.owner && $(`tab-${this.owner}`).hidden;
    $("tts-mini").hidden = !away;
    document.body.classList.toggle("has-mini", !!away);
    if (away) {
      $("tts-mini-label").textContent =
        this.owner === "question" ? "🔊 問題文を読み上げ中" : "🔊 設問と解答を読み上げ中";
      $("tts-mini-go").textContent = this.owner === "question" ? "問題文へ" : "解答へ";
    }
  },
};

// 長い文は途中で止まるブラウザがあるので、「。」ごとに分けて読む
function sentences(text) {
  return text.match(/[^。]+。?/g) || [];
}

// 読み上げ中にマーカーで問題文が描き直されても追えるよう、要素は読む直前に探す
function questionItems() {
  const items = [];
  $("q-text").querySelectorAll("h4, .para").forEach((el) => {
    const key = el.dataset.para;
    const find = () => $("q-text").querySelector(`[data-para="${key}"]`);
    sentences(el.textContent).forEach((t) => items.push({ text: t, find }));
  });
  return items;
}

function answerItems() {
  const items = [];
  for (const q of current.content.questions) {
    const find = () => $("a-list").querySelector(`[data-q="${q.id}"]`);
    const push = (text) => items.push({ text, find });
    push(`${q.label.replace("(", "の").replace(")", "")}。`);
    sentences(q.text).forEach(push);
    push(`解答例。${q.answer}。`);
    push(`分類は、${TYPE_LABELS[q.type] || q.type}。`);
    if (q.point) sentences(q.point).forEach(push);
  }
  return items;
}

function setupTts() {
  if ("speechSynthesis" in window) {
    tts.pickVoice();
    speechSynthesis.addEventListener("voiceschanged", () => tts.pickVoice());
  }
  document.querySelectorAll(".tts").forEach((box) => {
    const owner = box.dataset.tts;
    const items = () => (owner === "question" ? questionItems() : answerItems());
    box.querySelector(".tts-play").addEventListener("click", () => {
      if (tts.owner === owner) {
        tts.pause();
        return;
      }
      if (!current || !current.content) return;
      tts.play(owner, items(), tts.positions[owner] || 0);
    });
    box.querySelector(".tts-restart").addEventListener("click", () => {
      if (!current || !current.content) return;
      tts.play(owner, items(), 0);
    });
    box.querySelectorAll(".tts-rates button").forEach((b) => {
      b.addEventListener("click", () => tts.setRate(Number(b.dataset.rate)));
    });
  });
  $("tts-mini-pause").addEventListener("click", () => tts.pause());
  $("tts-mini-go").addEventListener("click", () => showTab(tts.owner));
  tts.updateButtons();
}

// ---------- 図解の拡大表示 ----------

// 別の画面で開くと読み上げが止まることがあるので、アプリの中で拡大する
function setupDiagramViewer() {
  const viewer = $("diagram-viewer");
  const img = $("diagram-viewer-img");
  $("d-diagram-link").addEventListener("click", (e) => {
    e.preventDefault();
    img.src = $("d-diagram").src;
    img.classList.remove("zoom");
    viewer.hidden = false;
    document.body.classList.add("no-scroll");
  });
  img.addEventListener("click", () => img.classList.toggle("zoom"));
  $("diagram-viewer-close").addEventListener("click", () => {
    viewer.hidden = true;
    document.body.classList.remove("no-scroll");
  });
}

// ---------- 画面遷移とイベント ----------

function route() {
  const m = location.hash.match(/^#\/case\/([^/]+)(?:\/(\w+))?$/);
  if (m) renderDetail(decodeURIComponent(m[1]), m[2]);
  else renderList();
}

function setupEvents() {
  const audio = $("d-audio");

  $("back").addEventListener("click", () => {
    location.hash = "";
  });

  document.querySelectorAll(".tabs button").forEach((b) => {
    b.addEventListener("click", () => showTab(b.dataset.tab));
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
  audio.addEventListener("play", () => tts.pause());
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
    const id = current.case.id;
    const done = !caseProgress(id).done;
    updateCaseProgress(id, { done });
    renderDone(done);
  });

  setupMarkers();
  setupAnswers();
  setupTts();
  setupDiagramViewer();
  window.addEventListener("hashchange", route);
}

// タブを上部バーのすぐ下で止めるため、バーの高さを CSS に渡す
function syncBarHeight() {
  document.documentElement.style.setProperty("--bar-h", `${document.querySelector(".bar").offsetHeight}px`);
}

async function init() {
  syncBarHeight();
  window.addEventListener("resize", syncBarHeight);
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
