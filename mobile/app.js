// ================= STATE & STORAGE (SYNCED WITH DESKTOP SCHEMA) =================
const STORAGE_KEYS = {
  CURRICULUM: "bsnt_curriculum_v1",
  QUESTIONS: "bsnt_questions_v1",
  HISTORY: "bsnt_history_v1",
  BOOKMARKS: "bsnt_bookmarks_v1",
  SESSIONS: "bsnt_sessions_v1",
  LAST_SESSION: "bsnt_last_session_v1",
  THEME: "bsnt_theme_v1",
  DATA_REVISION: "bsnt_data_revision_v1"
};

let state = {
  curriculum: [],
  questions: [],
  history: {},
  bookmarks: [],
  sessions: {},
  lastSessionKey: null,
  currentView: "dashboard", // 'dashboard' | 'subject' | 'quiz' | 'question-bank' | 'settings'
  activeSubjectId: null,
  bankFilterSubject: "all",
  bankFilterLesson: "all",
  bankSearchQuery: "",
  paletteFilter: "all", // 'all' | 'unanswered' | 'flagged' | 'wrong'
  quiz: {
    title: "",
    mode: "tutor",
    sessionKey: null,
    sessionMeta: null,
    questions: [],
    currentIndex: 0,
    answers: {},
    revealed: {},
    flagged: {},
    submitted: false,
    timerSeconds: 0,
    timerInterval: null
  }
};

let deferredInstallPrompt = null;
let installBannerDismissed = false;
let toastTimer = null;

function showToast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 2400);
}

function loadState() {
  const defCurr = typeof DEFAULT_CURRICULUM !== "undefined" ? DEFAULT_CURRICULUM : [];
  const defQues = typeof DEFAULT_QUESTIONS !== "undefined" ? DEFAULT_QUESTIONS : [];
  const currentRev = typeof DATA_REVISION !== "undefined" ? DATA_REVISION : "";

  const savedCurr = localStorage.getItem(STORAGE_KEYS.CURRICULUM);
  const savedQues = localStorage.getItem(STORAGE_KEYS.QUESTIONS);
  const savedHist = localStorage.getItem(STORAGE_KEYS.HISTORY);
  const savedBook = localStorage.getItem(STORAGE_KEYS.BOOKMARKS);
  const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME) || "light";

  if (savedCurr) {
    state.curriculum = JSON.parse(savedCurr);
    defCurr.forEach(defSubj => {
      const existingSubj = state.curriculum.find(s => s.id === defSubj.id);
      if (!existingSubj) {
        state.curriculum.push(JSON.parse(JSON.stringify(defSubj)));
      } else {
        defSubj.lessons.forEach(defLes => {
          const exLes = existingSubj.lessons.find(l => l.id === defLes.id);
          if (!exLes) {
            existingSubj.lessons.push(JSON.parse(JSON.stringify(defLes)));
          } else {
            exLes.title = defLes.title;
            exLes.description = defLes.description;
          }
        });
        if (defSubj.id === "hoa-sinh") {
          const validIds = new Set(defSubj.lessons.map(l => l.id));
          existingSubj.lessons = existingSubj.lessons.filter(l => validIds.has(l.id));
          const lessonOrder = defSubj.lessons.map(l => l.id);
          existingSubj.lessons.sort((a, b) => {
            const idxA = lessonOrder.indexOf(a.id);
            const idxB = lessonOrder.indexOf(b.id);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            return 0;
          });
        }
      }
    });
  } else {
    state.curriculum = JSON.parse(JSON.stringify(defCurr));
  }

  const savedRev = localStorage.getItem(STORAGE_KEYS.DATA_REVISION);
  const revChanged = Boolean(currentRev) && savedRev !== currentRev;

  if (savedQues) {
    state.questions = JSON.parse(savedQues).filter(q => q.id !== "q-hs-1" && q.id !== "q-hs-2");
    state.questions.forEach(q => {
      if (q.lessonId === "hs-enzym") q.lessonId = "hs-acid-citric";
      if (q.lessonId === "hs-glucid-lipid") q.lessonId = "hs-glucid";
      if (q.lessonId === "hs-protid-gan") q.lessonId = "hs-gan";
    });
    const existingIdxMap = new Map(state.questions.map((q, idx) => [q.id, idx]));
    defQues.forEach(defQ => {
      const exIdx = existingIdxMap.get(defQ.id);
      if (exIdx === undefined) {
        existingIdxMap.set(defQ.id, state.questions.length);
        state.questions.push(JSON.parse(JSON.stringify(defQ)));
      } else if (revChanged && !state.questions[exIdx].userEdited) {
        state.questions[exIdx] = JSON.parse(JSON.stringify(defQ));
      }
    });
  } else {
    state.questions = JSON.parse(JSON.stringify(defQues));
  }

  if (currentRev) {
    localStorage.setItem(STORAGE_KEYS.DATA_REVISION, currentRev);
  }

  state.history = savedHist ? JSON.parse(savedHist) : {};
  state.bookmarks = savedBook ? JSON.parse(savedBook) : [];

  const savedSessions = localStorage.getItem(STORAGE_KEYS.SESSIONS);
  const savedLastSession = localStorage.getItem(STORAGE_KEYS.LAST_SESSION);
  state.sessions = savedSessions ? (JSON.parse(savedSessions) || {}) : {};
  state.lastSessionKey = savedLastSession || null;

  if (savedSessions === null && Object.keys(state.history).length > 0) {
    migrateHistoryToLessonSessions();
  }

  applyTheme(savedTheme);
  saveState();
}

function saveState() {
  localStorage.setItem(STORAGE_KEYS.CURRICULUM, JSON.stringify(state.curriculum));
  localStorage.setItem(STORAGE_KEYS.QUESTIONS, JSON.stringify(state.questions));
  localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(state.history));
  localStorage.setItem(STORAGE_KEYS.BOOKMARKS, JSON.stringify(state.bookmarks));
  localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(state.sessions));
  if (state.lastSessionKey) {
    localStorage.setItem(STORAGE_KEYS.LAST_SESSION, state.lastSessionKey);
  } else {
    localStorage.removeItem(STORAGE_KEYS.LAST_SESSION);
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const meta = document.getElementById("meta-theme-color");
  if (meta) meta.setAttribute("content", theme === "dark" ? "#090e1a" : "#2563eb");
}

// ================= SESSION PROGRESS & RESUME HELPERS =================
function getSessionKey(kind, { subjectId = null, lessonId = null, groupName = null, mode = "tutor" } = {}) {
  if (kind === "lesson") return `lesson:${subjectId}:${lessonId}:${mode}`;
  if (kind === "subject") return `subject:${subjectId}:${mode}`;
  if (kind === "group") return `group:${groupName}:${mode}`;
  return null;
}

function findFirstUnansweredIndex(questions, answers, startIdx = 0) {
  for (let i = startIdx; i < questions.length; i++) {
    if (answers[questions[i].id] === undefined) return i;
  }
  for (let i = 0; i < startIdx && i < questions.length; i++) {
    if (answers[questions[i].id] === undefined) return i;
  }
  return -1;
}

function findResumeIndex(questions, session, answers, mode = "tutor") {
  if (!questions.length) return 0;
  let savedIdx = -1;
  if (session?.currentQuestionId) {
    savedIdx = questions.findIndex(q => q.id === session.currentQuestionId);
  }
  if (savedIdx === -1 && Number.isInteger(session?.currentIndex)) {
    savedIdx = Math.max(0, Math.min(session.currentIndex, questions.length - 1));
  }
  if (mode === "exam" && savedIdx !== -1) return savedIdx;
  if (savedIdx !== -1 && answers[questions[savedIdx].id] === undefined) return savedIdx;

  const nextUnanswered = findFirstUnansweredIndex(questions, answers, savedIdx !== -1 ? savedIdx + 1 : 0);
  if (nextUnanswered !== -1) return nextUnanswered;
  return savedIdx !== -1 ? savedIdx : 0;
}

function buildOrderedQuestionsFromSession(availableQuestions, savedQuestionIds) {
  if (!Array.isArray(savedQuestionIds) || savedQuestionIds.length === 0) return availableQuestions;
  const qMap = new Map(availableQuestions.map(q => [q.id, q]));
  const ordered = [];
  const seen = new Set();
  savedQuestionIds.forEach(id => {
    const q = qMap.get(id);
    if (q && !seen.has(id)) {
      ordered.push(q);
      seen.add(id);
    }
  });
  availableQuestions.forEach(q => {
    if (!seen.has(q.id)) {
      ordered.push(q);
      seen.add(q.id);
    }
  });
  return ordered;
}

function hydrateAnswersFromHistory(questions) {
  const answers = {};
  const revealed = {};
  questions.forEach(q => {
    const h = state.history[q.id];
    if (h && typeof h.lastChoice === "number" && h.lastChoice >= 0 && h.lastChoice < q.options.length) {
      answers[q.id] = h.lastChoice;
      revealed[q.id] = true;
    }
  });
  return { answers, revealed };
}

function migrateHistoryToLessonSessions() {
  let firstPartialKey = null;
  state.curriculum.forEach(subj => {
    subj.lessons.forEach(lesson => {
      const lessonQ = state.questions.filter(q => q.subjectId === subj.id && q.lessonId === lesson.id);
      if (!lessonQ.length) return;
      const { answers, revealed } = hydrateAnswersFromHistory(lessonQ);
      const answeredCount = Object.keys(answers).length;
      if (answeredCount === 0) return;

      const key = getSessionKey("lesson", { subjectId: subj.id, lessonId: lesson.id, mode: "tutor" });
      const resumeIdx = findResumeIndex(lessonQ, null, answers, "tutor");
      state.sessions[key] = {
        key,
        kind: "lesson",
        subjectId: subj.id,
        lessonId: lesson.id,
        groupName: null,
        title: `${subj.name} — ${lesson.title}`,
        mode: "tutor",
        preserveLiveOrder: true,
        questionIds: null,
        currentIndex: resumeIdx,
        currentQuestionId: lessonQ[resumeIdx]?.id || null,
        answers,
        revealed,
        flagged: {},
        submitted: false,
        timerSeconds: 0,
        updatedAt: new Date().toISOString()
      };
      if (!firstPartialKey && answeredCount < lessonQ.length) firstPartialKey = key;
    });
  });
  if (!state.lastSessionKey && firstPartialKey) state.lastSessionKey = firstPartialKey;
}

function getLessonSessionProgress(subjectId, lessonId, lessonQuestions) {
  const total = lessonQuestions.length;
  const tutorKey = getSessionKey("lesson", { subjectId, lessonId, mode: "tutor" });
  const tutorSess = state.sessions[tutorKey];
  let tutorAnswered = 0;
  if (tutorSess) {
    tutorAnswered = lessonQuestions.filter(q => {
      const ch = tutorSess.answers?.[q.id];
      return typeof ch === "number" && ch >= 0 && ch < q.options.length;
    }).length;
  } else {
    tutorAnswered = lessonQuestions.filter(q => {
      const h = state.history[q.id];
      return h && typeof h.lastChoice === "number" && h.lastChoice >= 0 && h.lastChoice < q.options.length;
    }).length;
  }

  const examKey = getSessionKey("lesson", { subjectId, lessonId, mode: "exam" });
  const examSess = state.sessions[examKey];
  let examInProgress = false;
  let examAnswered = 0;
  if (examSess && !examSess.submitted) {
    examAnswered = lessonQuestions.filter(q => typeof examSess.answers?.[q.id] === "number").length;
    examInProgress = examAnswered > 0;
  }
  return { total, tutorAnswered, examInProgress, examAnswered };
}

function resolveQuestionsForSession(sess) {
  if (!sess) return [];
  if (sess.kind === "lesson") {
    return state.questions.filter(q => q.subjectId === sess.subjectId && q.lessonId === sess.lessonId);
  }
  if (sess.kind === "subject") {
    const qs = state.questions.filter(q => q.subjectId === sess.subjectId);
    return buildOrderedQuestionsFromSession(qs, sess.questionIds);
  }
  if (sess.kind === "group") {
    const subjectIds = state.curriculum.filter(s => s.group === sess.groupName).map(s => s.id);
    const qs = state.questions.filter(q => subjectIds.includes(q.subjectId));
    return buildOrderedQuestionsFromSession(qs, sess.questionIds);
  }
  return [];
}

function getLastActiveSessionBannerData() {
  if (!state.lastSessionKey) return null;
  const sess = state.sessions[state.lastSessionKey];
  if (!sess || (sess.mode === "exam" && sess.submitted)) return null;
  const qs = resolveQuestionsForSession(sess);
  if (!qs.length) return null;

  const validAnswers = {};
  qs.forEach(q => {
    const ch = sess.answers?.[q.id];
    if (typeof ch === "number" && ch >= 0 && ch < q.options.length) validAnswers[q.id] = ch;
  });
  const answeredCount = Object.keys(validAnswers).length;
  if (answeredCount === 0 || answeredCount >= qs.length) return null;

  const nextIdx = findResumeIndex(qs, sess, validAnswers, sess.mode);
  return {
    title: sess.title,
    mode: sess.mode,
    answeredCount,
    totalCount: qs.length,
    nextQuestionNum: nextIdx + 1
  };
}

function resumeLastSession() {
  const sess = state.sessions[state.lastSessionKey];
  if (!sess) {
    state.lastSessionKey = null;
    saveState();
    renderMain();
    return;
  }
  if (sess.kind === "lesson") {
    state.activeSubjectId = sess.subjectId;
    startLessonQuiz(sess.subjectId, sess.lessonId, sess.mode);
  } else if (sess.kind === "subject") {
    state.activeSubjectId = sess.subjectId;
    startSubjectQuiz(sess.subjectId, sess.mode);
  } else if (sess.kind === "group") {
    state.activeSubjectId = null;
    startGroupQuiz(sess.groupName, sess.mode);
  }
}

function saveCurrentQuizSession() {
  if (state.currentView !== "quiz" || !state.quiz.sessionKey) return;
  const key = state.quiz.sessionKey;
  const prevMeta = state.sessions[key] || {};
  const meta = state.quiz.sessionMeta || {};
  const preserveLiveOrder = Boolean(meta.preserveLiveOrder ?? prevMeta.preserveLiveOrder);
  const currentQ = state.quiz.questions[state.quiz.currentIndex];

  state.sessions[key] = {
    key,
    kind: meta.kind || prevMeta.kind || "lesson",
    subjectId: meta.subjectId ?? prevMeta.subjectId ?? null,
    lessonId: meta.lessonId ?? prevMeta.lessonId ?? null,
    groupName: meta.groupName ?? prevMeta.groupName ?? null,
    title: state.quiz.title,
    mode: state.quiz.mode,
    preserveLiveOrder,
    questionIds: preserveLiveOrder ? null : state.quiz.questions.map(q => q.id),
    currentIndex: state.quiz.currentIndex,
    currentQuestionId: currentQ ? currentQ.id : null,
    answers: { ...state.quiz.answers },
    revealed: { ...state.quiz.revealed },
    flagged: { ...state.quiz.flagged },
    submitted: Boolean(state.quiz.submitted),
    timerSeconds: state.quiz.timerSeconds || 0,
    updatedAt: new Date().toISOString()
  };

  const answeredCount = Object.keys(state.quiz.answers).length;
  const totalCount = state.quiz.questions.length;
  const isDone = state.quiz.mode === "exam" ? Boolean(state.quiz.submitted) : answeredCount >= totalCount;

  if (answeredCount > 0 && !isDone) state.lastSessionKey = key;
  else if (state.lastSessionKey === key) state.lastSessionKey = null;
}

function escapeHTML(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatMarkdownSimple(text) {
  if (!text) return "";
  return escapeHTML(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br>");
}

// ================= NAVIGATION =================
function openDashboard() {
  stopTimer();
  state.currentView = "dashboard";
  renderMain();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function openSubjectsTab() {
  const targetId = state.activeSubjectId || state.curriculum[0]?.id;
  if (targetId) openSubject(targetId);
  else openDashboard();
}

function openSubject(subjectId) {
  stopTimer();
  state.currentView = "subject";
  state.activeSubjectId = subjectId;
  renderMain();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function openQuestionBank(filterSubjectId = state.bankFilterSubject, filterLessonId = "all") {
  stopTimer();
  state.currentView = "question-bank";
  state.bankFilterSubject = filterSubjectId || "all";
  state.bankFilterLesson = filterLessonId || "all";
  renderMain();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function openSettingsTab() {
  stopTimer();
  state.currentView = "settings";
  renderMain();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function handleTopBack() {
  if (state.currentView === "quiz") {
    if (state.activeSubjectId) openSubject(state.activeSubjectId);
    else openDashboard();
  } else if (state.currentView === "subject") {
    openDashboard();
  }
}

function syncChromeBars() {
  const mainEl = document.getElementById("main-content");
  const bottomNav = document.getElementById("bottom-nav");
  const quizBar = document.getElementById("quiz-bottom-bar");
  const backBtn = document.getElementById("btn-topbar-back");

  const isQuiz = state.currentView === "quiz";
  mainEl.classList.toggle("quiz-mode", isQuiz);
  bottomNav.style.display = isQuiz ? "none" : "grid";
  quizBar.classList.toggle("active", isQuiz);
  backBtn.style.display = (isQuiz || state.currentView === "subject") ? "inline-flex" : "none";

  document.querySelectorAll(".nav-tab").forEach(btn => {
    const tab = btn.getAttribute("data-tab");
    btn.classList.toggle("active", tab === state.currentView);
  });

  if (isQuiz && state.quiz.questions.length) {
    const prevBtn = document.getElementById("quiz-prev-btn");
    const palBtn = document.getElementById("quiz-palette-btn");
    const nextBtn = document.getElementById("quiz-next-btn");
    const total = state.quiz.questions.length;
    const idx = state.quiz.currentIndex;

    prevBtn.disabled = idx === 0;
    palBtn.textContent = `⊞ ${idx + 1}/${total}`;

    const isLast = idx === total - 1;
    if (state.quiz.mode === "exam" && !state.quiz.submitted && isLast) {
      nextBtn.textContent = "✅ Nộp bài";
      nextBtn.disabled = false;
      nextBtn.onclick = submitExam;
    } else {
      nextBtn.textContent = "Tiếp ➡️";
      nextBtn.disabled = isLast;
      nextBtn.onclick = nextQuestion;
    }
  }
}

function renderMain() {
  const mainEl = document.getElementById("main-content");
  const topTitle = document.getElementById("topbar-title");

  if (state.currentView === "dashboard") {
    topTitle.textContent = "🩺 BSNT YHCT Pro";
    mainEl.innerHTML = renderDashboardHTML();
  } else if (state.currentView === "subject") {
    const subj = state.curriculum.find(s => s.id === state.activeSubjectId) || state.curriculum[0];
    if (!subj) return openDashboard();
    state.activeSubjectId = subj.id;
    topTitle.textContent = `${subj.icon} ${subj.name}`;
    mainEl.innerHTML = renderSubjectHTML(subj);
  } else if (state.currentView === "quiz") {
    topTitle.textContent = state.quiz.title;
    mainEl.innerHTML = renderQuizHTML();
    bindQuizSwipe();
  } else if (state.currentView === "question-bank") {
    topTitle.textContent = `🗂️ Ngân hàng (${state.questions.length} câu)`;
    mainEl.innerHTML = renderQuestionBankHTML();
  } else if (state.currentView === "settings") {
    topTitle.textContent = "⚙️ Dữ liệu & Cài đặt";
    mainEl.innerHTML = renderSettingsHTML();
  }

  syncChromeBars();
}

// ================= VIEW 1: DASHBOARD =================
function renderDashboardHTML() {
  const totalQ = state.questions.length;
  const qIdSet = new Set(state.questions.map(q => q.id));
  const answeredIds = Object.keys(state.history).filter(id => qIdSet.has(id));
  const answeredCount = answeredIds.length;
  const correctCount = answeredIds.filter(id => state.history[id]?.isCorrect).length;
  const wrongCount = answeredCount - correctCount;
  const accuracy = answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0;

  const basicSubjects = state.curriculum.filter(s => s.group === "Cơ bản");
  const specSubjects = state.curriculum.filter(s => s.group !== "Cơ bản");

  const installHTML = deferredInstallPrompt && !installBannerDismissed ? `
    <div class="install-banner">
      <div style="font-size:13px;">
        <strong>📲 Cài app lên Samsung</strong>
        <div style="color:var(--text-muted); font-size:12px;">Chạy toàn màn hình & offline</div>
      </div>
      <div style="display:flex; gap:6px;">
        <button class="btn btn-sm btn-primary" onclick="triggerPWAInstall()">Cài ngay</button>
        <button class="btn btn-sm btn-outline" onclick="installBannerDismissed=true; renderMain();">✕</button>
      </div>
    </div>
  ` : "";

  const lastBanner = getLastActiveSessionBannerData();
  const resumeHTML = lastBanner ? `
    <div class="resume-card">
      <div>
        <div style="font-size:12px; font-weight:700; color:var(--primary);">📌 BÀI ĐANG LÀM DỞ</div>
        <div style="font-weight:700; font-size:15px; margin-top:2px;">${escapeHTML(lastBanner.title)}</div>
        <div style="font-size:12.5px; color:var(--text-muted); margin-top:2px;">
          Đã làm ${lastBanner.answeredCount}/${lastBanner.totalCount} câu • Tiếp câu ${lastBanner.nextQuestionNum}
        </div>
      </div>
      <button class="btn btn-primary btn-block" onclick="resumeLastSession()">▶️ Làm tiếp ngay</button>
    </div>
  ` : "";

  const renderSubjItem = (subj) => {
    const subjQ = state.questions.filter(q => q.subjectId === subj.id);
    const done = subjQ.filter(q => state.history[q.id]).length;
    const right = subjQ.filter(q => state.history[q.id]?.isCorrect).length;
    const pct = subjQ.length > 0 ? Math.round((done / subjQ.length) * 100) : 0;

    return `
      <div class="subject-item" onclick="openSubject('${subj.id}')">
        <div class="subject-top">
          <div class="subject-icon" style="background:${subj.color}18; color:${subj.color};">${subj.icon}</div>
          <div class="subject-text">
            <h3>${escapeHTML(subj.name)}</h3>
            <p>${escapeHTML(subj.description || "Ôn tập trắc nghiệm")}</p>
          </div>
          <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); openSubjectModal('${subj.id}')" aria-label="Sửa môn">✏️</button>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${pct}%; background-color:${subj.color};"></div>
        </div>
        <div class="subject-foot">
          <span>📑 ${subj.lessons.length} bài</span>
          <span>❓ ${subjQ.length} câu</span>
          <span>✅ Đúng ${right}/${done}</span>
        </div>
      </div>
    `;
  };

  return `
    ${installHTML}

    <div class="stats-grid">
      <div class="stat-tile">
        <div class="stat-tile-val">${totalQ}</div>
        <div class="stat-tile-lbl">Tổng câu hỏi</div>
      </div>
      <div class="stat-tile">
        <div class="stat-tile-val">${answeredCount}</div>
        <div class="stat-tile-lbl">Đã làm (${totalQ ? Math.round((answeredCount / totalQ) * 100) : 0}%)</div>
      </div>
      <div class="stat-tile">
        <div class="stat-tile-val" style="color:var(--success);">${accuracy}%</div>
        <div class="stat-tile-lbl">Chính xác</div>
      </div>
    </div>

    <div class="quick-actions-row">
      <button class="btn btn-outline" onclick="startFilteredQuiz('wrong')">🔁 Câu sai (${wrongCount})</button>
      <button class="btn btn-outline" onclick="startFilteredQuiz('bookmark')">⭐ Đã lưu (${state.bookmarks.length})</button>
    </div>

    ${resumeHTML}

    <div class="section-head">
      <h2>🔬 Khối Cơ Bản</h2>
      <div style="display:flex; gap:6px;">
        <button class="btn btn-sm btn-outline" onclick="openSubjectModal(null, 'Cơ bản')">➕ Môn</button>
        <button class="btn btn-sm btn-primary" onclick="startGroupQuiz('Cơ bản', 'exam')">⏱️ Thi khối</button>
      </div>
    </div>
    <div class="subject-list">
      ${basicSubjects.map(renderSubjItem).join("")}
    </div>

    <div class="section-head">
      <h2>☯️ Khối Chuyên Ngành</h2>
      <div style="display:flex; gap:6px;">
        <button class="btn btn-sm btn-outline" onclick="openSubjectModal(null, 'Chuyên ngành')">➕ Môn</button>
        <button class="btn btn-sm btn-primary" onclick="startGroupQuiz('Chuyên ngành', 'exam')">⏱️ Thi khối</button>
      </div>
    </div>
    <div class="subject-list">
      ${specSubjects.map(renderSubjItem).join("")}
    </div>
  `;
}

// ================= VIEW 2: SUBJECT & LESSONS =================
function renderSubjectHTML(subj) {
  const allSubjQ = state.questions.filter(q => q.subjectId === subj.id);

  const chipsHTML = state.curriculum.map(s => `
    <button class="chip ${s.id === subj.id ? "active" : ""}" onclick="openSubject('${s.id}')">
      <span>${s.icon}</span>
      <span>${escapeHTML(s.name)}</span>
    </button>
  `).join("");

  const subjTutorSess = state.sessions[getSessionKey("subject", { subjectId: subj.id, mode: "tutor" })];
  const subjTutorDone = subjTutorSess ? allSubjQ.filter(q => typeof subjTutorSess.answers?.[q.id] === "number").length : 0;
  const subjTutorLabel = subjTutorDone > 0 && subjTutorDone < allSubjQ.length
    ? `▶️ Tiếp (${subjTutorDone}/${allSubjQ.length})`
    : `🚀 Luyện toàn môn`;

  const lessonsHTML = subj.lessons.map((lesson, idx) => {
    const lessonQ = allSubjQ.filter(q => q.lessonId === lesson.id);
    const doneCount = lessonQ.filter(q => state.history[q.id]).length;
    const correctCount = lessonQ.filter(q => state.history[q.id]?.isCorrect).length;
    const wrongCount = doneCount - correctCount;
    const prog = getLessonSessionProgress(subj.id, lesson.id, lessonQ);

    let tutorBtnLabel = "🧠 Luyện tập";
    if (prog.total > 0 && prog.tutorAnswered > 0 && prog.tutorAnswered < prog.total) {
      tutorBtnLabel = `▶️ Tiếp (${prog.tutorAnswered}/${prog.total})`;
    } else if (prog.total > 0 && prog.tutorAnswered >= prog.total) {
      tutorBtnLabel = `✅ Xem lại (${prog.total})`;
    }
    const examBtnLabel = prog.examInProgress ? `▶️ Thi tiếp (${prog.examAnswered}/${prog.total})` : "⏱️ Thi thử";

    return `
      <div class="lesson-card">
        <div class="lesson-head">
          <h4>${escapeHTML(lesson.title)}</h4>
          <button class="btn btn-sm btn-outline" onclick="openLessonModal('${subj.id}', '${lesson.id}')" aria-label="Sửa bài">✏️</button>
        </div>
        <div class="lesson-desc">${escapeHTML(lesson.description || "Chưa có mô tả chi tiết")}</div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <span class="pill">Tổng: ${lessonQ.length}</span>
          <span class="pill">Đã làm: ${doneCount}/${lessonQ.length}</span>
          ${correctCount > 0 ? `<span class="pill correct">Đúng: ${correctCount}</span>` : ""}
          ${wrongCount > 0 ? `<span class="pill wrong">Sai: ${wrongCount}</span>` : ""}
        </div>
        <div class="lesson-btn-grid">
          <button class="btn btn-primary" onclick="startLessonQuiz('${subj.id}', '${lesson.id}', 'tutor')">${tutorBtnLabel}</button>
          <button class="btn btn-outline" onclick="startLessonQuiz('${subj.id}', '${lesson.id}', 'exam')">${examBtnLabel}</button>
        </div>
        <div class="lesson-sub-actions">
          <button class="btn btn-sm btn-outline" onclick="openQuestionBank('${subj.id}', '${lesson.id}')">📋 DS câu (${lessonQ.length})</button>
          <button class="btn btn-sm btn-outline" onclick="openQuestionModal('${subj.id}', '${lesson.id}')">➕ Câu</button>
          <button class="btn btn-sm btn-outline" onclick="openBulkImportModal('${subj.id}', '${lesson.id}')">📥 Nhập lô</button>
          ${prog.tutorAnswered > 0 ? `<button class="btn btn-sm btn-outline" onclick="restartLessonQuiz('${subj.id}', '${lesson.id}', 'tutor')">🔄 Làm lại</button>` : ""}
          <button class="btn btn-sm btn-outline" onclick="moveLesson('${subj.id}', ${idx}, -1)" ${idx === 0 ? "disabled" : ""}>↑</button>
          <button class="btn btn-sm btn-outline" onclick="moveLesson('${subj.id}', ${idx}, 1)" ${idx === subj.lessons.length - 1 ? "disabled" : ""}>↓</button>
          <button class="btn btn-sm btn-danger-soft" onclick="deleteLesson('${subj.id}', '${lesson.id}')">🗑️</button>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="subject-chips">${chipsHTML}</div>

    <div class="card" style="display:flex; flex-direction:column; gap:10px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
        <div>
          <div style="font-size:17px; font-weight:800;">${subj.icon} ${escapeHTML(subj.name)}</div>
          <div style="font-size:13px; color:var(--text-muted);">${escapeHTML(subj.description || "")} • ${subj.lessons.length} bài • ${allSubjQ.length} câu</div>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="btn btn-sm btn-outline" onclick="openSubjectModal('${subj.id}')">✏️</button>
          <button class="btn btn-sm btn-danger-soft" onclick="deleteSubject('${subj.id}')">🗑️</button>
        </div>
      </div>
      <div class="lesson-btn-grid">
        <button class="btn btn-primary" onclick="startSubjectQuiz('${subj.id}', 'tutor')">${subjTutorLabel}</button>
        <button class="btn btn-outline" onclick="startSubjectQuiz('${subj.id}', 'exam')">⏱️ Thi thử môn</button>
      </div>
      <div class="lesson-btn-grid">
        <button class="btn btn-sm btn-outline" onclick="openLessonModal('${subj.id}')">📁 + Thêm bài nhỏ</button>
        <button class="btn btn-sm btn-outline" onclick="openBulkImportModal('${subj.id}')">📥 Nhập lô câu</button>
      </div>
    </div>

    ${lessonsHTML || `<div class="card" style="text-align:center; color:var(--text-muted);">Chưa có bài nhỏ nào. Bấm <strong>📁 + Thêm bài nhỏ</strong> để tạo.</div>`}
  `;
}

// ================= VIEW 3: QUIZ ENGINE =================
function startLessonQuiz(subjectId, lessonId, mode) {
  const subj = state.curriculum.find(s => s.id === subjectId);
  const lesson = subj?.lessons.find(l => l.id === lessonId);
  if (!subj || !lesson) return;
  const qs = state.questions.filter(q => q.subjectId === subjectId && q.lessonId === lessonId);
  if (!qs.length) {
    alert("Bài học này chưa có câu hỏi. Hãy bấm '➕ Câu' hoặc '📥 Nhập lô'!");
    return;
  }
  const sessionKey = getSessionKey("lesson", { subjectId, lessonId, mode });
  launchQuiz(`${subj.name} — ${lesson.title}`, qs, mode, {
    sessionKey,
    sessionMeta: { kind: "lesson", subjectId, lessonId, preserveLiveOrder: true }
  });
}

function restartLessonQuiz(subjectId, lessonId, mode) {
  const subj = state.curriculum.find(s => s.id === subjectId);
  const lesson = subj?.lessons.find(l => l.id === lessonId);
  const qs = state.questions.filter(q => q.subjectId === subjectId && q.lessonId === lessonId);
  if (!subj || !lesson || !qs.length) return;
  if (!confirm(`Làm lại "${lesson.title}" từ câu 1?`)) return;
  const sessionKey = getSessionKey("lesson", { subjectId, lessonId, mode });
  launchQuiz(`${subj.name} — ${lesson.title}`, qs, mode, {
    sessionKey,
    sessionMeta: { kind: "lesson", subjectId, lessonId, preserveLiveOrder: true },
    forceFresh: true
  });
}

function startSubjectQuiz(subjectId, mode) {
  const subj = state.curriculum.find(s => s.id === subjectId);
  if (!subj) return;
  const qs = state.questions.filter(q => q.subjectId === subjectId);
  if (!qs.length) {
    alert("Môn học này hiện chưa có câu hỏi.");
    return;
  }
  const sessionKey = getSessionKey("subject", { subjectId, mode });
  const existing = state.sessions[sessionKey];
  const hasResumableOrder = existing && !(mode === "exam" && existing.submitted) && Array.isArray(existing.questionIds);
  const orderedQs = hasResumableOrder ? qs : shuffleArray([...qs]);
  launchQuiz(`Tổng hợp ${subj.name}`, orderedQs, mode, {
    sessionKey,
    sessionMeta: { kind: "subject", subjectId, preserveLiveOrder: false }
  });
}

function startGroupQuiz(groupName, mode) {
  const subjectIds = state.curriculum.filter(s => s.group === groupName).map(s => s.id);
  const qs = state.questions.filter(q => subjectIds.includes(q.subjectId));
  if (!qs.length) {
    alert("Khối môn này chưa có câu hỏi.");
    return;
  }
  const sessionKey = getSessionKey("group", { groupName, mode });
  const existing = state.sessions[sessionKey];
  const hasResumableOrder = existing && !(mode === "exam" && existing.submitted) && Array.isArray(existing.questionIds);
  const orderedQs = hasResumableOrder ? qs : shuffleArray([...qs]);
  launchQuiz(`Thi thử Khối ${groupName}`, orderedQs, mode, {
    sessionKey,
    sessionMeta: { kind: "group", groupName, preserveLiveOrder: false }
  });
}

function startFilteredQuiz(type) {
  let qs = [];
  let title = "";
  if (type === "wrong") {
    qs = state.questions.filter(q => state.history[q.id] && !state.history[q.id].isCorrect);
    title = "Ôn tập các câu làm sai";
  } else if (type === "bookmark") {
    qs = state.questions.filter(q => state.bookmarks.includes(q.id));
    title = "Ôn tập câu đã đánh dấu ⭐";
  }
  if (!qs.length) {
    alert(type === "wrong" ? "Tuyệt vời! Hiện không có câu làm sai cần ôn." : "Bạn chưa đánh dấu ⭐ câu hỏi nào.");
    return;
  }
  launchQuiz(title, shuffleArray([...qs]), "tutor");
}

function launchQuiz(title, questionsList, mode, options = {}) {
  stopTimer();
  const { sessionKey = null, sessionMeta = null, forceFresh = false } = options;

  let finalQuestions = questionsList;
  let currentIndex = 0;
  let answers = {};
  let revealed = {};
  let flagged = {};
  let submitted = false;
  let timerSeconds = mode === "exam" ? questionsList.length * 45 : 0;

  if (sessionKey) {
    const existing = state.sessions[sessionKey];
    const shouldResume = Boolean(existing) && !forceFresh && !(mode === "exam" && existing.submitted);
    if (shouldResume) {
      if (!sessionMeta?.preserveLiveOrder && Array.isArray(existing.questionIds)) {
        finalQuestions = buildOrderedQuestionsFromSession(questionsList, existing.questionIds);
      }
      const validQMap = new Map(finalQuestions.map(q => [q.id, q]));
      Object.entries(existing.answers || {}).forEach(([qId, ch]) => {
        const qObj = validQMap.get(qId);
        if (qObj && typeof ch === "number" && ch >= 0 && ch < qObj.options.length) {
          answers[qId] = ch;
          if (mode === "tutor" || existing.revealed?.[qId]) revealed[qId] = true;
        }
      });
      Object.entries(existing.flagged || {}).forEach(([qId, val]) => {
        if (val && validQMap.has(qId)) flagged[qId] = true;
      });
      submitted = mode === "exam" ? Boolean(existing.submitted) : false;
      if (mode === "exam" && typeof existing.timerSeconds === "number" && existing.timerSeconds > 0) {
        timerSeconds = existing.timerSeconds;
      }
      currentIndex = findResumeIndex(finalQuestions, existing, answers, mode);
    } else if (!forceFresh && mode === "tutor" && sessionMeta?.kind === "lesson") {
      const hydrated = hydrateAnswersFromHistory(finalQuestions);
      answers = hydrated.answers;
      revealed = hydrated.revealed;
      currentIndex = findResumeIndex(finalQuestions, null, answers, mode);
    }
  }

  state.currentView = "quiz";
  state.quiz = {
    title,
    mode,
    sessionKey,
    sessionMeta,
    questions: finalQuestions,
    currentIndex,
    answers,
    revealed,
    flagged,
    submitted,
    timerSeconds,
    timerInterval: null
  };

  if (sessionKey) {
    saveCurrentQuizSession();
    saveState();
  }

  if (mode === "exam" && !submitted) {
    state.quiz.timerInterval = setInterval(() => {
      if (state.quiz.timerSeconds > 0 && !state.quiz.submitted) {
        state.quiz.timerSeconds--;
        const timerEl = document.getElementById("quiz-timer-display");
        if (timerEl) timerEl.textContent = formatTime(state.quiz.timerSeconds);
        if (state.quiz.timerSeconds % 5 === 0) {
          saveCurrentQuizSession();
          saveState();
        }
      } else if (state.quiz.timerSeconds === 0 && !state.quiz.submitted) {
        submitExam();
      }
    }, 1000);
  }

  renderMain();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function restartCurrentQuiz() {
  if (!state.quiz.questions.length) return;
  const answeredCount = Object.keys(state.quiz.answers).length;
  if (answeredCount > 0 && answeredCount < state.quiz.questions.length) {
    if (!confirm("Làm lại đề này từ câu 1?")) return;
  }
  const title = state.quiz.title;
  const mode = state.quiz.mode;
  const sessionKey = state.quiz.sessionKey;
  const sessionMeta = state.quiz.sessionMeta ? { ...state.quiz.sessionMeta } : null;
  let freshQuestions = [...state.quiz.questions];
  if (sessionMeta && !sessionMeta.preserveLiveOrder) freshQuestions = shuffleArray(freshQuestions);
  closePaletteSheet();
  launchQuiz(title, freshQuestions, mode, { sessionKey, sessionMeta, forceFresh: true });
}

function stopTimer() {
  if (state.currentView === "quiz" && state.quiz?.sessionKey) {
    saveCurrentQuizSession();
    saveState();
  }
  if (state.quiz.timerInterval) {
    clearInterval(state.quiz.timerInterval);
    state.quiz.timerInterval = null;
  }
}

function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function renderQuizHTML() {
  if (!state.quiz.questions.length) return "";
  const total = state.quiz.questions.length;
  const idx = state.quiz.currentIndex;
  const qObj = state.quiz.questions[idx];
  const subj = state.curriculum.find(s => s.id === qObj.subjectId);
  const lesson = subj?.lessons.find(l => l.id === qObj.lessonId);
  const userChoice = state.quiz.answers[qObj.id];
  const isRevealed = state.quiz.mode === "tutor" ? state.quiz.revealed[qObj.id] : state.quiz.submitted;
  const isBookmarked = state.bookmarks.includes(qObj.id);
  const isFlagged = !!state.quiz.flagged[qObj.id];
  const letters = ["A", "B", "C", "D"];
  const answeredCount = Object.keys(state.quiz.answers).length;
  const pct = Math.round(((idx + 1) / total) * 100);

  let scoreSummaryHTML = "";
  if (state.quiz.submitted || (state.quiz.mode === "tutor" && Object.keys(state.quiz.revealed).length === total)) {
    const right = state.quiz.questions.filter(q => state.quiz.answers[q.id] === q.correctIndex).length;
    const score10 = ((right / total) * 10).toFixed(2);
    scoreSummaryHTML = `
      <div class="score-banner">
        <div style="font-weight:800; color:var(--success); font-size:15px;">
          🎉 Kết quả: Đúng ${right}/${total} (${Math.round((right / total) * 100)}%) — ${score10} điểm
        </div>
        <button class="btn btn-sm btn-primary" onclick="restartCurrentQuiz()">🔄 Làm lại đề này</button>
      </div>
    `;
  }

  const optionsHTML = qObj.options.map((optText, oIdx) => {
    let cls = "option-btn";
    if (isRevealed) {
      if (oIdx === qObj.correctIndex) cls += " correct";
      else if (oIdx === userChoice && userChoice !== qObj.correctIndex) cls += " wrong";
    } else if (userChoice === oIdx) {
      cls += " selected";
    }

    return `
      <button class="${cls}" onclick="selectOption(${oIdx})" ${isRevealed && state.quiz.mode === "tutor" ? "disabled" : ""}>
        <span class="option-letter">${letters[oIdx]}</span>
        <span>${escapeHTML(optText)}</span>
      </button>
    `;
  }).join("");

  return `
    ${scoreSummaryHTML}

    <div class="quiz-progress-strip">
      <div class="quiz-meta-row">
        <div style="display:flex; align-items:center; gap:6px;">
          <span class="pill primary">Câu ${idx + 1}/${total}</span>
          <span class="pill">Đã làm ${answeredCount}/${total}</span>
          ${state.quiz.mode === "exam" ? `<span class="quiz-timer-pill" id="quiz-timer-display">⏱️ ${formatTime(state.quiz.timerSeconds)}</span>` : ""}
        </div>
        <div class="quiz-tools-row">
          <button class="icon-btn" onclick="openQuestionModal(null, null, '${qObj.id}')" title="Sửa câu hỏi">✏️</button>
          <button class="icon-btn" onclick="toggleFlag('${qObj.id}')" title="Gắn cờ">${isFlagged ? "🚩" : "🏳️"}</button>
          <button class="icon-btn" onclick="toggleBookmark('${qObj.id}')" title="Lưu câu khó">${isBookmarked ? "⭐" : "☆"}</button>
        </div>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="width:${pct}%;"></div>
      </div>
    </div>

    <div class="quiz-card" id="quiz-swipe-card">
      <div class="quiz-lesson-tag">${subj ? escapeHTML(subj.name) : ""} • ${lesson ? escapeHTML(lesson.title) : ""}</div>
      <div class="question-stem">${escapeHTML(qObj.question)}</div>
      <div class="options-list">${optionsHTML}</div>

      ${isRevealed ? `
        <div class="explanation-box">
          <div class="explanation-head">
            <span>💡 Giải thích (Đáp án: ${letters[qObj.correctIndex]})</span>
            <button class="btn btn-sm btn-outline" onclick="openQuestionModal(null, null, '${qObj.id}')">✏️ Sửa</button>
          </div>
          <div>${formatMarkdownSimple(qObj.explanation || "Chưa có giải thích chi tiết. Bấm '✏️ Sửa' để thêm ghi chú.")}</div>
        </div>
      ` : ""}
    </div>

    <div class="swipe-hint">💡 Mẹo: Vuốt trái / phải trên thẻ câu hỏi để chuyển câu nhanh</div>
  `;
}

function bindQuizSwipe() {
  const card = document.getElementById("quiz-swipe-card");
  if (!card) return;
  let startX = 0;
  let startY = 0;
  let tracking = false;

  card.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true;
  }, { passive: true });

  card.addEventListener("touchend", (e) => {
    if (!tracking || e.changedTouches.length !== 1) return;
    tracking = false;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.45) {
      if (dx < 0) nextQuestion();
      else prevQuestion();
    }
  }, { passive: true });
}

function selectOption(choiceIndex) {
  const qObj = state.quiz.questions[state.quiz.currentIndex];
  if (state.quiz.submitted) return;
  if (state.quiz.mode === "tutor" && state.quiz.revealed[qObj.id]) return;

  state.quiz.answers[qObj.id] = choiceIndex;
  if (state.quiz.mode === "tutor") {
    state.quiz.revealed[qObj.id] = true;
    const isCorrect = choiceIndex === qObj.correctIndex;
    state.history[qObj.id] = {
      lastChoice: choiceIndex,
      isCorrect,
      attempts: (state.history[qObj.id]?.attempts || 0) + 1
    };
  }
  saveCurrentQuizSession();
  saveState();
  renderMain();
}

function submitExam() {
  const unanswered = state.quiz.questions.length - Object.keys(state.quiz.answers).length;
  if (unanswered > 0 && state.quiz.timerSeconds > 0) {
    if (!confirm(`Bạn còn ${unanswered} câu chưa chọn đáp án. Vẫn nộp bài ngay?`)) return;
  }
  state.quiz.submitted = true;
  stopTimer();
  state.quiz.questions.forEach(q => {
    const ans = state.quiz.answers[q.id];
    if (ans !== undefined) {
      state.history[q.id] = {
        lastChoice: ans,
        isCorrect: ans === q.correctIndex,
        attempts: (state.history[q.id]?.attempts || 0) + 1
      };
    }
  });
  saveCurrentQuizSession();
  saveState();
  closePaletteSheet();
  renderMain();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function prevQuestion() {
  if (state.quiz.currentIndex > 0) {
    state.quiz.currentIndex--;
    saveCurrentQuizSession();
    saveState();
    renderMain();
    window.scrollTo({ top: 0, behavior: "instant" });
  }
}

function nextQuestion() {
  if (state.quiz.currentIndex < state.quiz.questions.length - 1) {
    state.quiz.currentIndex++;
    saveCurrentQuizSession();
    saveState();
    renderMain();
    window.scrollTo({ top: 0, behavior: "instant" });
  }
}

function jumpToQuestion(idx) {
  state.quiz.currentIndex = idx;
  saveCurrentQuizSession();
  saveState();
  closePaletteSheet();
  renderMain();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function toggleFlag(qId) {
  state.quiz.flagged[qId] = !state.quiz.flagged[qId];
  saveCurrentQuizSession();
  saveState();
  renderMain();
  showToast(state.quiz.flagged[qId] ? "🚩 Đã gắn cờ câu này" : "Đã bỏ gắn cờ");
}

function toggleBookmark(qId) {
  const idx = state.bookmarks.indexOf(qId);
  if (idx === -1) {
    state.bookmarks.push(qId);
    showToast("⭐ Đã lưu vào câu hỏi khó");
  } else {
    state.bookmarks.splice(idx, 1);
    showToast("Đã bỏ lưu câu hỏi");
  }
  saveState();
  renderMain();
}

// ================= PALETTE BOTTOM SHEET =================
function openPaletteSheet() {
  renderPaletteSheetBody();
  document.getElementById("sheet-palette").classList.add("open");
}

function closePaletteSheet() {
  document.getElementById("sheet-palette").classList.remove("open");
}

function setPaletteFilter(filter) {
  state.paletteFilter = filter;
  renderPaletteSheetBody();
}

function renderPaletteSheetBody() {
  const body = document.getElementById("palette-sheet-body");
  const title = document.getElementById("palette-sheet-title");
  if (!body || !state.quiz.questions.length) return;

  const total = state.quiz.questions.length;
  const answeredInSession = Object.keys(state.quiz.answers).length;
  title.textContent = `Bảng câu hỏi (${answeredInSession}/${total})`;

  const nextUnansweredIdx = findFirstUnansweredIndex(
    state.quiz.questions,
    state.quiz.answers,
    state.quiz.currentIndex + 1
  );

  const itemsHTML = state.quiz.questions
    .map((item, idx) => {
      const ans = state.quiz.answers[item.id];
      const rev = state.quiz.mode === "tutor" ? state.quiz.revealed[item.id] : state.quiz.submitted;
      const isFlag = !!state.quiz.flagged[item.id];
      const isWrong = rev && ans !== item.correctIndex;

      if (state.paletteFilter === "unanswered" && ans !== undefined) return "";
      if (state.paletteFilter === "flagged" && !isFlag) return "";
      if (state.paletteFilter === "wrong" && !isWrong) return "";

      let pCls = "palette-item";
      if (idx === state.quiz.currentIndex) pCls += " current";
      if (rev) {
        pCls += ans === item.correctIndex ? " correct" : " wrong";
      } else if (ans !== undefined) {
        pCls += " answered";
      }
      if (isFlag) pCls += " flagged";

      return `<div class="${pCls}" onclick="jumpToQuestion(${idx})">${idx + 1}</div>`;
    })
    .join("");

  body.innerHTML = `
    <div style="display:flex; gap:6px; overflow-x:auto;">
      <button class="chip ${state.paletteFilter === "all" ? "active" : ""}" onclick="setPaletteFilter('all')">Tất cả (${total})</button>
      <button class="chip ${state.paletteFilter === "unanswered" ? "active" : ""}" onclick="setPaletteFilter('unanswered')">Chưa làm (${total - answeredInSession})</button>
      <button class="chip ${state.paletteFilter === "flagged" ? "active" : ""}" onclick="setPaletteFilter('flagged')">🚩 Gắn cờ</button>
      <button class="chip ${state.paletteFilter === "wrong" ? "active" : ""}" onclick="setPaletteFilter('wrong')">❌ Sai</button>
    </div>

    <div class="palette-grid">
      ${itemsHTML || `<div style="grid-column:1/-1; text-align:center; color:var(--text-muted); padding:16px;">Không có câu nào khớp bộ lọc.</div>`}
    </div>

    <div style="display:flex; flex-direction:column; gap:8px; margin-top:4px;">
      ${nextUnansweredIdx !== -1 ? `<button class="btn btn-primary btn-block" onclick="jumpToQuestion(${nextUnansweredIdx})">⏭️ Tới câu chưa làm (Câu ${nextUnansweredIdx + 1})</button>` : ""}
      ${state.quiz.mode === "exam" && !state.quiz.submitted ? `<button class="btn btn-primary btn-block" onclick="submitExam()">✅ Nộp bài & Chấm điểm</button>` : ""}
      ${answeredInSession > 0 ? `<button class="btn btn-outline btn-block" onclick="restartCurrentQuiz()">🔄 Làm lại từ đầu</button>` : ""}
      <button class="btn btn-danger-soft btn-block" onclick="closePaletteSheet(); handleTopBack();">🔙 Thoát phiên làm bài</button>
    </div>
  `;
}

// ================= VIEW 4: QUESTION BANK =================
function filteredQuestionsFromCurrentBank() {
  const filterSubj = state.bankFilterSubject || "all";
  const filterLesson = state.bankFilterLesson || "all";
  const searchQ = (state.bankSearchQuery || "").toLowerCase().trim();
  return state.questions.filter(q => {
    if (filterSubj !== "all" && q.subjectId !== filterSubj) return false;
    if (filterLesson !== "all" && q.lessonId !== filterLesson) return false;
    if (searchQ) {
      const hay = `${q.question} ${q.options.join(" ")} ${q.explanation || ""}`.toLowerCase();
      if (!hay.includes(searchQ)) return false;
    }
    return true;
  });
}

function renderBankListItemsHTML(filtered) {
  const letters = ["A", "B", "C", "D"];
  if (!filtered.length) {
    return `<div class="card" style="text-align:center; color:var(--text-muted);">Không tìm thấy câu hỏi phù hợp.</div>`;
  }
  const maxShow = 80;
  const sliced = filtered.slice(0, maxShow);
  const cards = sliced.map((q, idx) => {
    const subj = state.curriculum.find(s => s.id === q.subjectId);
    const lesson = subj?.lessons.find(l => l.id === q.lessonId);
    return `
      <div class="bank-item">
        <div style="font-size:12px; color:var(--primary); font-weight:700;">
          ${subj ? escapeHTML(subj.name) : ""} • ${lesson ? escapeHTML(lesson.title) : ""}
        </div>
        <div style="font-weight:700; font-size:14.5px;">Câu ${idx + 1}: ${escapeHTML(q.question)}</div>
        <div class="bank-options">
          ${q.options.map((opt, oIdx) => `
            <div style="${oIdx === q.correctIndex ? "color:var(--success); font-weight:700;" : "color:var(--text-muted);"}">
              ${letters[oIdx]}. ${escapeHTML(opt)} ${oIdx === q.correctIndex ? "✓" : ""}
            </div>
          `).join("")}
        </div>
        ${q.explanation ? `<div style="font-size:12.5px; color:var(--text-muted); background:var(--bg-main); padding:8px 10px; border-radius:8px;">${formatMarkdownSimple(q.explanation)}</div>` : ""}
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="btn btn-sm btn-outline" onclick="openQuestionModal(null, null, '${q.id}')">✏️ Sửa</button>
          <button class="btn btn-sm btn-outline" onclick="duplicateQuestion('${q.id}')">📋 Nhân bản</button>
          <button class="btn btn-sm btn-danger-soft" onclick="deleteQuestion('${q.id}')">🗑️ Xóa</button>
        </div>
      </div>
    `;
  }).join("");

  const notice = filtered.length > maxShow
    ? `<div class="card" style="text-align:center; font-size:13px; color:var(--text-muted);">Đang hiển thị ${maxShow}/${filtered.length} câu. Hãy lọc theo môn/bài hoặc tìm từ khóa để thu hẹp danh sách.</div>`
    : "";

  return cards + notice;
}

function handleBankSearch(val) {
  state.bankSearchQuery = val;
  const filtered = filteredQuestionsFromCurrentBank();
  const countEl = document.getElementById("bank-count-label");
  const listEl = document.getElementById("bank-list-container");
  const practiceBtn = document.getElementById("bank-practice-btn");
  if (countEl) countEl.textContent = `Hiển thị: ${filtered.length} câu`;
  if (practiceBtn) {
    practiceBtn.style.display = filtered.length > 0 ? "inline-flex" : "none";
    practiceBtn.textContent = `🚀 Luyện ${filtered.length} câu`;
  }
  if (listEl) listEl.innerHTML = renderBankListItemsHTML(filtered);
}

function renderQuestionBankHTML() {
  const filterSubj = state.bankFilterSubject || "all";
  const filterLesson = state.bankFilterLesson || "all";
  const selectedSubjObj = state.curriculum.find(s => s.id === filterSubj);
  const filtered = filteredQuestionsFromCurrentBank();

  return `
    <div class="card" style="display:flex; flex-direction:column; gap:10px;">
      <select class="form-control" onchange="openQuestionBank(this.value, 'all')">
        <option value="all" ${filterSubj === "all" ? "selected" : ""}>Tất cả môn (${state.questions.length} câu)</option>
        ${state.curriculum.map(s => `<option value="${s.id}" ${filterSubj === s.id ? "selected" : ""}>${s.icon} ${escapeHTML(s.name)}</option>`).join("")}
      </select>

      <select class="form-control" onchange="openQuestionBank('${filterSubj}', this.value)" ${filterSubj === "all" ? "disabled" : ""}>
        <option value="all" ${filterLesson === "all" ? "selected" : ""}>Tất cả bài học trong môn</option>
        ${selectedSubjObj ? selectedSubjObj.lessons.map(l => `<option value="${l.id}" ${filterLesson === l.id ? "selected" : ""}>${escapeHTML(l.title)}</option>`).join("") : ""}
      </select>

      <input type="search" class="form-control" placeholder="🔍 Tìm từ khóa câu hỏi..." value="${escapeHTML(state.bankSearchQuery || "")}" oninput="handleBankSearch(this.value)" />

      <div class="lesson-btn-grid">
        <button class="btn btn-primary" onclick="openQuestionModal('${filterSubj === "all" ? (state.curriculum[0]?.id || "giai-phau") : filterSubj}', '${filterLesson === "all" ? "" : filterLesson}')">➕ Thêm câu</button>
        <button class="btn btn-outline" onclick="openBulkImportModal('${filterSubj === "all" ? (state.curriculum[0]?.id || "giai-phau") : filterSubj}', '${filterLesson === "all" ? "" : filterLesson}')">📥 Nhập lô</button>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; padding-top:4px; border-top:1px solid var(--border-color);">
        <span id="bank-count-label" style="font-size:13px; color:var(--text-muted); font-weight:600;">Hiển thị: ${filtered.length} câu</span>
        <button id="bank-practice-btn" class="btn btn-sm btn-soft" style="${filtered.length > 0 ? "" : "display:none;"}" onclick="launchQuiz('Luyện tập danh sách lọc', filteredQuestionsFromCurrentBank(), 'tutor')">🚀 Luyện ${filtered.length} câu</button>
      </div>
    </div>

    <div id="bank-list-container" style="display:flex; flex-direction:column; gap:10px;">
      ${renderBankListItemsHTML(filtered)}
    </div>
  `;
}

// ================= VIEW 5: SETTINGS & SYNC =================
function renderSettingsHTML() {
  const rev = localStorage.getItem(STORAGE_KEYS.DATA_REVISION) || (typeof DATA_REVISION !== "undefined" ? DATA_REVISION : "N/A");
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const isSecure = window.isSecureContext;

  return `
    <div class="card" style="display:flex; flex-direction:column; gap:10px;">
      <div style="font-size:16px; font-weight:800;">📲 Cài thành App trên Samsung</div>
      <div style="font-size:13.5px; color:var(--text-muted);">
        ${isStandalone
          ? "✅ Bạn đang chạy ứng dụng ở chế độ App toàn màn hình (Standalone)."
          : "Để mở nhanh từ màn hình chính Samsung như một app độc lập:"}
      </div>
      ${deferredInstallPrompt ? `
        <button class="btn btn-primary btn-block" onclick="triggerPWAInstall()">📲 Cài đặt ứng dụng ngay</button>
      ` : `
        <div style="background:var(--bg-main); padding:10px 12px; border-radius:10px; font-size:13px; line-height:1.55;">
          <strong>Cách cài trên Samsung:</strong><br>
          • <strong>Chrome:</strong> Bấm dấu <code>⋮</code> góc trên phải → <strong>Thêm vào Màn hình chính</strong> (hoặc <em>Cài đặt ứng dụng</em>).<br>
          • <strong>Samsung Internet:</strong> Bấm nút <code>☰</code> hoặc biểu tượng tải xuống trên thanh địa chỉ → <strong>Thêm trang vào → Màn hình chính</strong>.
        </div>
      `}
      <div style="font-size:12px; color:var(--text-muted);">
        Trạng thái kết nối an toàn (Service Worker offline): ${isSecure && "serviceWorker" in navigator ? "✅ Sẵn sàng" : "⚠️ Đang chạy HTTP nội bộ (vẫn lưu toàn bộ dữ liệu vào bộ nhớ máy)"}
      </div>
    </div>

    <div class="card" style="display:flex; flex-direction:column; gap:10px;">
      <div style="font-size:16px; font-weight:800;">🔄 Đồng bộ giữa PC & Samsung (.json)</div>
      <div style="font-size:13px; color:var(--text-muted);">
        Tương thích 100% với bản máy tính: giữ nguyên câu hỏi tự thêm, lịch sử đúng/sai, câu ⭐ và bài đang làm dở.
      </div>
      <button class="btn btn-primary btn-block" onclick="exportBackupJSON()">💾 Xuất file sao lưu (.json)</button>
      <button class="btn btn-outline btn-block" onclick="document.getElementById('import-json-input').click()">📂 Nhập / Khôi phục từ (.json)</button>
      <button class="btn btn-outline btn-block" onclick="exportToDataJS()">⚡ Tải về file data.js</button>
    </div>

    <div class="card" style="display:flex; flex-direction:column; gap:10px;">
      <div style="font-size:16px; font-weight:800;">🎨 Giao diện & Dữ liệu</div>
      <button class="btn btn-outline btn-block" onclick="toggleTheme()">🌗 Chuyển chế độ Sáng / Tối</button>
      <button class="btn btn-danger-soft btn-block" onclick="resetProgress()">🔄 Đặt lại lịch sử làm bài</button>
      <div style="font-size:12.5px; color:var(--text-muted); padding-top:4px;">
        • Tổng số môn: <strong>${state.curriculum.length}</strong> • Tổng câu hỏi: <strong>${state.questions.length}</strong><br>
        • Phiên bản dữ liệu: <code>${escapeHTML(rev)}</code>
      </div>
    </div>
  `;
}

async function triggerPWAInstall() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  if (choice?.outcome === "accepted") {
    showToast("🎉 Đã thêm ứng dụng vào màn hình chính!");
  }
  deferredInstallPrompt = null;
  renderMain();
}

// ================= CRUD: SUBJECTS, LESSONS, QUESTIONS =================
function openSubjectModal(editSubjectId = null, defaultGroup = "Cơ bản") {
  const header = document.getElementById("subject-modal-header");
  const editIdInput = document.getElementById("subj-edit-id");
  const nameInput = document.getElementById("subj-name-input");
  const groupSelect = document.getElementById("subj-group-select");
  const iconInput = document.getElementById("subj-icon-input");
  const colorInput = document.getElementById("subj-color-input");
  const descInput = document.getElementById("subj-desc-input");

  if (editSubjectId) {
    const subj = state.curriculum.find(s => s.id === editSubjectId);
    if (!subj) return;
    header.textContent = `✏️ Sửa môn: ${subj.name}`;
    editIdInput.value = subj.id;
    nameInput.value = subj.name;
    groupSelect.value = subj.group;
    iconInput.value = subj.icon;
    colorInput.value = subj.color || "#2563eb";
    descInput.value = subj.description || "";
  } else {
    header.textContent = "📚 Thêm Môn học mới";
    editIdInput.value = "";
    nameInput.value = "";
    groupSelect.value = defaultGroup;
    iconInput.value = "📘";
    colorInput.value = "#2563eb";
    descInput.value = "";
  }
  document.getElementById("modal-subject").classList.add("open");
}

function saveSubjectModal() {
  const editId = document.getElementById("subj-edit-id").value;
  const name = document.getElementById("subj-name-input").value.trim();
  const group = document.getElementById("subj-group-select").value;
  const icon = document.getElementById("subj-icon-input").value.trim() || "📘";
  const color = document.getElementById("subj-color-input").value || "#2563eb";
  const description = document.getElementById("subj-desc-input").value.trim();

  if (!name) {
    alert("Vui lòng nhập tên môn học!");
    return;
  }

  if (editId) {
    const subj = state.curriculum.find(s => s.id === editId);
    if (subj) {
      subj.name = name;
      subj.group = group;
      subj.icon = icon;
      subj.color = color;
      subj.description = description;
    }
  } else {
    const newId = `mon-${Date.now()}`;
    state.curriculum.push({
      id: newId,
      name,
      group,
      icon,
      color,
      description,
      lessons: [{ id: `${newId}-b1`, title: "Bài 1: Đại cương & Cơ sở", description: "Kiến thức trọng tâm bài 1" }]
    });
  }

  saveState();
  closeModals();
  renderMain();
  showToast("💾 Đã lưu môn học");
}

function deleteSubject(subjectId) {
  const subj = state.curriculum.find(s => s.id === subjectId);
  if (!subj) return;
  const qCount = state.questions.filter(q => q.subjectId === subjectId).length;
  if (!confirm(`Xóa môn "${subj.name}" (${subj.lessons.length} bài và ${qCount} câu hỏi)?`)) return;

  state.curriculum = state.curriculum.filter(s => s.id !== subjectId);
  state.questions = state.questions.filter(q => q.subjectId !== subjectId);
  Object.keys(state.sessions).forEach(key => {
    if (state.sessions[key]?.subjectId === subjectId) {
      delete state.sessions[key];
      if (state.lastSessionKey === key) state.lastSessionKey = null;
    }
  });
  saveState();
  openDashboard();
  showToast("🗑️ Đã xóa môn học");
}

function openLessonModal(subjectId, editLessonId = null) {
  const subj = state.curriculum.find(s => s.id === subjectId);
  if (!subj) return;
  document.getElementById("lesson-modal-subject-id").value = subjectId;
  document.getElementById("lesson-modal-edit-id").value = editLessonId || "";

  if (editLessonId) {
    const lesson = subj.lessons.find(l => l.id === editLessonId);
    document.getElementById("lesson-modal-header").textContent = `✏️ Sửa bài (${subj.name})`;
    document.getElementById("lesson-title-input").value = lesson ? lesson.title : "";
    document.getElementById("lesson-desc-input").value = lesson ? lesson.description : "";
  } else {
    document.getElementById("lesson-modal-header").textContent = `📁 Thêm bài mới (${subj.name})`;
    document.getElementById("lesson-title-input").value = `Bài ${subj.lessons.length + 1}: `;
    document.getElementById("lesson-desc-input").value = "";
  }
  document.getElementById("modal-lesson").classList.add("open");
}

function saveLessonModal() {
  const subjectId = document.getElementById("lesson-modal-subject-id").value;
  const editLessonId = document.getElementById("lesson-modal-edit-id").value;
  const title = document.getElementById("lesson-title-input").value.trim();
  const description = document.getElementById("lesson-desc-input").value.trim();

  if (!title) {
    alert("Vui lòng nhập tên bài học!");
    return;
  }

  const subj = state.curriculum.find(s => s.id === subjectId);
  if (!subj) return;

  if (editLessonId) {
    const lesson = subj.lessons.find(l => l.id === editLessonId);
    if (lesson) {
      lesson.title = title;
      lesson.description = description;
    }
  } else {
    subj.lessons.push({ id: `${subjectId}-b${Date.now()}`, title, description });
  }

  saveState();
  closeModals();
  renderMain();
  showToast("💾 Đã lưu bài học");
}

function moveLesson(subjectId, index, direction) {
  const subj = state.curriculum.find(s => s.id === subjectId);
  if (!subj) return;
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= subj.lessons.length) return;
  const temp = subj.lessons[index];
  subj.lessons[index] = subj.lessons[newIndex];
  subj.lessons[newIndex] = temp;
  saveState();
  renderMain();
}

function deleteLesson(subjectId, lessonId) {
  const subj = state.curriculum.find(s => s.id === subjectId);
  if (!subj) return;
  const lesson = subj.lessons.find(l => l.id === lessonId);
  const qCount = state.questions.filter(q => q.subjectId === subjectId && q.lessonId === lessonId).length;
  if (!confirm(`Xóa "${lesson?.title}"? (${qCount} câu hỏi thuộc bài này cũng sẽ bị xóa)`)) return;

  subj.lessons = subj.lessons.filter(l => l.id !== lessonId);
  state.questions = state.questions.filter(q => !(q.subjectId === subjectId && q.lessonId === lessonId));
  Object.keys(state.sessions).forEach(key => {
    const s = state.sessions[key];
    if (s && s.subjectId === subjectId && s.lessonId === lessonId) {
      delete state.sessions[key];
      if (state.lastSessionKey === key) state.lastSessionKey = null;
    }
  });
  saveState();
  renderMain();
  showToast("🗑️ Đã xóa bài học");
}

function openQuestionModal(subjectId = null, lessonId = null, editQuestionId = null) {
  const editInput = document.getElementById("q-edit-id");
  const header = document.getElementById("q-modal-header");
  const subjSelect = document.getElementById("q-subject-select");

  if (editQuestionId) {
    const qObj = state.questions.find(q => q.id === editQuestionId);
    if (!qObj) return;
    header.textContent = "✏️ Chỉnh sửa câu hỏi";
    editInput.value = qObj.id;
    subjSelect.innerHTML = state.curriculum.map(s =>
      `<option value="${s.id}" ${s.id === qObj.subjectId ? "selected" : ""}>${escapeHTML(s.name)}</option>`
    ).join("");
    updateLessonDropdown(qObj.subjectId, qObj.lessonId);

    document.getElementById("q-stem-input").value = qObj.question;
    document.getElementById("q-opt-0").value = qObj.options[0] || "";
    document.getElementById("q-opt-1").value = qObj.options[1] || "";
    document.getElementById("q-opt-2").value = qObj.options[2] || "";
    document.getElementById("q-opt-3").value = qObj.options[3] || "";
    document.getElementById("q-correct-select").value = String(qObj.correctIndex);
    document.getElementById("q-exp-input").value = qObj.explanation || "";
  } else {
    const targetSubjId = subjectId || state.activeSubjectId || state.curriculum[0]?.id;
    header.textContent = "➕ Thêm câu hỏi mới";
    editInput.value = "";
    subjSelect.innerHTML = state.curriculum.map(s =>
      `<option value="${s.id}" ${s.id === targetSubjId ? "selected" : ""}>${escapeHTML(s.name)}</option>`
    ).join("");
    updateLessonDropdown(targetSubjId, lessonId);

    document.getElementById("q-stem-input").value = "";
    document.getElementById("q-opt-0").value = "";
    document.getElementById("q-opt-1").value = "";
    document.getElementById("q-opt-2").value = "";
    document.getElementById("q-opt-3").value = "";
    document.getElementById("q-correct-select").value = "0";
    document.getElementById("q-exp-input").value = "";
  }
  document.getElementById("modal-question").classList.add("open");
}

function updateLessonDropdown(subjectId, selectedLessonId = null) {
  const subj = state.curriculum.find(s => s.id === subjectId);
  const lessonSelect = document.getElementById("q-lesson-select");
  if (!subj) return;
  lessonSelect.innerHTML = subj.lessons.map(l =>
    `<option value="${l.id}" ${l.id === selectedLessonId ? "selected" : ""}>${escapeHTML(l.title)}</option>`
  ).join("");
}

function saveQuestionModal() {
  const editId = document.getElementById("q-edit-id").value;
  const subjectId = document.getElementById("q-subject-select").value;
  const lessonId = document.getElementById("q-lesson-select").value;
  const question = document.getElementById("q-stem-input").value.trim();
  const opt0 = document.getElementById("q-opt-0").value.trim();
  const opt1 = document.getElementById("q-opt-1").value.trim();
  const opt2 = document.getElementById("q-opt-2").value.trim();
  const opt3 = document.getElementById("q-opt-3").value.trim();
  const correctIndex = parseInt(document.getElementById("q-correct-select").value, 10);
  const explanation = document.getElementById("q-exp-input").value.trim();

  if (!question || !opt0 || !opt1 || !opt2 || !opt3) {
    alert("Vui lòng nhập đầy đủ câu dẫn và 4 phương án A, B, C, D!");
    return;
  }

  if (editId) {
    const qObj = state.questions.find(q => q.id === editId);
    if (qObj) {
      qObj.subjectId = subjectId;
      qObj.lessonId = lessonId;
      qObj.question = question;
      qObj.options = [opt0, opt1, opt2, opt3];
      qObj.correctIndex = correctIndex;
      qObj.explanation = explanation;
      qObj.userEdited = true;
    }
    const quizQ = state.quiz.questions.find(q => q.id === editId);
    if (quizQ) {
      quizQ.subjectId = subjectId;
      quizQ.lessonId = lessonId;
      quizQ.question = question;
      quizQ.options = [opt0, opt1, opt2, opt3];
      quizQ.correctIndex = correctIndex;
      quizQ.explanation = explanation;
    }
  } else {
    state.questions.push({
      id: `q-${Date.now()}`,
      subjectId,
      lessonId,
      question,
      options: [opt0, opt1, opt2, opt3],
      correctIndex,
      explanation
    });
  }

  saveState();
  closeModals();
  renderMain();
  showToast("💾 Đã lưu câu hỏi");
}

function duplicateQuestion(qId) {
  const orig = state.questions.find(q => q.id === qId);
  if (!orig) return;
  const copy = JSON.parse(JSON.stringify(orig));
  copy.id = `q-${Date.now()}`;
  copy.question = copy.question + " (Bản sao)";
  state.questions.push(copy);
  saveState();
  renderMain();
  openQuestionModal(null, null, copy.id);
}

function deleteQuestion(qId) {
  if (!confirm("Xóa câu hỏi này khỏi ngân hàng?")) return;
  state.questions = state.questions.filter(q => q.id !== qId);
  delete state.history[qId];
  state.bookmarks = state.bookmarks.filter(id => id !== qId);
  Object.values(state.sessions).forEach(sess => {
    if (!sess) return;
    if (sess.answers) delete sess.answers[qId];
    if (sess.revealed) delete sess.revealed[qId];
    if (sess.flagged) delete sess.flagged[qId];
    if (Array.isArray(sess.questionIds)) sess.questionIds = sess.questionIds.filter(id => id !== qId);
    if (sess.currentQuestionId === qId) sess.currentQuestionId = null;
  });
  saveState();
  renderMain();
  showToast("🗑️ Đã xóa câu hỏi");
}

// ================= BULK IMPORT =================
function openBulkImportModal(subjectId, lessonId = null) {
  const targetSubjId = subjectId || state.activeSubjectId || state.curriculum[0]?.id;
  const subjSelect = document.getElementById("bulk-subject-select");
  subjSelect.innerHTML = state.curriculum.map(s =>
    `<option value="${s.id}" ${s.id === targetSubjId ? "selected" : ""}>${escapeHTML(s.name)}</option>`
  ).join("");
  updateBulkLessonDropdown(targetSubjId, lessonId);
  document.getElementById("bulk-text-input").value = "";
  document.getElementById("modal-bulk-import").classList.add("open");
}

function updateBulkLessonDropdown(subjectId, selectedLessonId = null) {
  const subj = state.curriculum.find(s => s.id === subjectId);
  const lessonSelect = document.getElementById("bulk-lesson-select");
  if (!subj) return;
  lessonSelect.innerHTML = subj.lessons.map(l =>
    `<option value="${l.id}" ${l.id === selectedLessonId ? "selected" : ""}>${escapeHTML(l.title)}</option>`
  ).join("");
}

function processBulkImport() {
  const subjectId = document.getElementById("bulk-subject-select").value;
  const lessonId = document.getElementById("bulk-lesson-select").value;
  const raw = document.getElementById("bulk-text-input").value.trim();
  if (!raw) {
    alert("Vui lòng dán nội dung câu hỏi vào ô văn bản!");
    return;
  }

  const blocks = raw.split(/\n\s*\n+|\n(?=\s*Câu\s+\d+[\.\:\)])/i).map(b => b.trim()).filter(Boolean);
  let importedCount = 0;

  blocks.forEach((block, bIdx) => {
    const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length < 5) return;

    let questionLines = [];
    let options = [];
    let correctIndex = 0;
    let explanationLines = [];
    let inExplanation = false;

    lines.forEach(line => {
      if (/^(Giải thích|GT|Hướng dẫn)\s*:/i.test(line)) {
        inExplanation = true;
        explanationLines.push(line.replace(/^(Giải thích|GT|Hướng dẫn)\s*:\s*/i, ""));
        return;
      }
      if (inExplanation) {
        explanationLines.push(line);
        return;
      }
      const ansLineMatch = line.match(/^(Đáp án|ĐA)\s*:\s*([A-D])/i);
      if (ansLineMatch) {
        correctIndex = "ABCD".indexOf(ansLineMatch[2].toUpperCase());
        return;
      }
      const optMatch = line.match(/^(\*)?([A-D])[\.\)\:]\s*(.+)$/i);
      if (optMatch && options.length < 4) {
        if (optMatch[1] === "*") correctIndex = options.length;
        options.push(optMatch[3].trim());
      } else if (options.length === 0) {
        questionLines.push(line.replace(/^Câu\s*\d+[\.\:\)]\s*/i, ""));
      }
    });

    if (questionLines.length > 0 && options.length === 4) {
      state.questions.push({
        id: `q-${Date.now()}-${bIdx}`,
        subjectId,
        lessonId,
        question: questionLines.join("\n"),
        options,
        correctIndex,
        explanation: explanationLines.join("\n")
      });
      importedCount++;
    }
  });

  if (importedCount === 0) {
    alert("Không nhận diện được câu hỏi hợp lệ. Hãy đảm bảo mỗi câu có câu dẫn và 4 dòng A., B., C., D.");
    return;
  }

  saveState();
  closeModals();
  renderMain();
  showToast(`🎉 Đã nhập ${importedCount} câu hỏi!`);
}

function closeModals() {
  document.querySelectorAll(".sheet-backdrop").forEach(el => {
    if (el.id !== "sheet-palette") el.classList.remove("open");
  });
}

// ================= BACKUP / SYNC / THEME =================
function exportToDataJS() {
  const jsContent =
    `const DATA_REVISION = ${JSON.stringify(new Date().toISOString())};\n\n` +
    `const DEFAULT_CURRICULUM = ${JSON.stringify(state.curriculum, null, 2)};\n\n` +
    `const DEFAULT_QUESTIONS = ${JSON.stringify(state.questions, null, 2)};\n`;

  const blob = new Blob([jsContent], { type: "text/javascript;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "data.js";
  a.click();
  URL.revokeObjectURL(url);
  showToast("⚡ Đã tải xuống file data.js");
}

function exportBackupJSON() {
  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    curriculum: state.curriculum,
    questions: state.questions,
    history: state.history,
    bookmarks: state.bookmarks,
    sessions: state.sessions,
    lastSessionKey: state.lastSessionKey
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bsnt-yhct-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("💾 Đã xuất file sao lưu .json");
}

function importBackupJSON(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.curriculum && data.questions) {
        if (!confirm(`Khôi phục ${data.questions.length} câu hỏi và lịch sử học tập từ "${file.name}"? (Dữ liệu hiện tại trên máy sẽ được thay thế)`)) {
          return;
        }
        state.curriculum = data.curriculum;
        state.questions = data.questions;
        state.history = data.history || {};
        state.bookmarks = data.bookmarks || [];
        state.sessions = data.sessions || {};
        state.lastSessionKey = data.lastSessionKey || null;
        if (!data.sessions && Object.keys(state.history).length > 0) {
          migrateHistoryToLessonSessions();
        }
        saveState();
        renderMain();
        showToast(`✅ Đã khôi phục ${state.questions.length} câu hỏi!`);
      } else {
        alert("File JSON không đúng cấu trúc.");
      }
    } catch (err) {
      alert("Lỗi đọc file JSON: " + err.message);
    }
  };
  reader.readAsText(file);
}

function resetProgress() {
  if (!confirm("Xóa lịch sử làm bài để luyện lại từ đầu? (Câu hỏi và bài học vẫn giữ nguyên)")) return;
  state.history = {};
  state.sessions = {};
  state.lastSessionKey = null;
  saveState();
  renderMain();
  showToast("🔄 Đã đặt lại lịch sử làm bài");
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") || "light";
  const next = cur === "light" ? "dark" : "light";
  applyTheme(next);
  localStorage.setItem(STORAGE_KEYS.THEME, next);
  showToast(next === "dark" ? "🌙 Đã bật giao diện Tối" : "☀️ Đã bật giao diện Sáng");
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ================= PWA & INIT =================
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (state.currentView === "dashboard" || state.currentView === "settings") {
    renderMain();
  }
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  showToast("🎉 Đã cài đặt BSNT YHCT Pro!");
  renderMain();
});

window.addEventListener("beforeunload", () => {
  if (state.currentView === "quiz" && state.quiz?.sessionKey) {
    saveCurrentQuizSession();
    saveState();
  }
});

window.addEventListener("DOMContentLoaded", () => {
  loadState();
  renderMain();

  if (
    "serviceWorker" in navigator &&
    (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
});
