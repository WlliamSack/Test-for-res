// ================= STATE & STORAGE =================
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
  currentView: "dashboard", // 'dashboard' | 'subject' | 'quiz' | 'question-bank'
  activeSubjectId: null,
  bankFilterSubject: "all",
  bankFilterLesson: "all",
  bankSearchQuery: "",
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

function loadState() {
  const savedCurr = localStorage.getItem(STORAGE_KEYS.CURRICULUM);
  const savedQues = localStorage.getItem(STORAGE_KEYS.QUESTIONS);
  const savedHist = localStorage.getItem(STORAGE_KEYS.HISTORY);
  const savedBook = localStorage.getItem(STORAGE_KEYS.BOOKMARKS);
  const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME) || "light";

  if (savedCurr) {
    state.curriculum = JSON.parse(savedCurr);
    // Tự động bổ sung/đồng bộ môn và bài học từ DEFAULT_CURRICULUM nếu file data.js được cập nhật
    DEFAULT_CURRICULUM.forEach(defSubj => {
      const existingSubj = state.curriculum.find(s => s.id === defSubj.id);
      if (!existingSubj) {
        state.curriculum.push(JSON.parse(JSON.stringify(defSubj)));
      } else {
        // Cập nhật hoặc bổ sung các bài học
        defSubj.lessons.forEach(defLes => {
          const exLes = existingSubj.lessons.find(l => l.id === defLes.id);
          if (!exLes) {
            existingSubj.lessons.push(JSON.parse(JSON.stringify(defLes)));
          } else {
            exLes.title = defLes.title;
            exLes.description = defLes.description;
          }
        });
        // Dọn dẹp bài học cũ nếu có thay đổi cấu trúc môn học (ví dụ hs-enzym, hs-glucid-lipid)
        if (defSubj.id === "hoa-sinh") {
          const validIds = new Set(defSubj.lessons.map(l => l.id));
          existingSubj.lessons = existingSubj.lessons.filter(l => validIds.has(l.id));
          // Sắp xếp lại thứ tự bài học theo đúng DEFAULT_CURRICULUM
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
    state.curriculum = JSON.parse(JSON.stringify(DEFAULT_CURRICULUM));
  }

  const currentRev = typeof DATA_REVISION !== "undefined" ? DATA_REVISION : "";
  const savedRev = localStorage.getItem(STORAGE_KEYS.DATA_REVISION);
  const revChanged = Boolean(currentRev) && savedRev !== currentRev;

  if (savedQues) {
    // Loại bỏ 2 câu mẫu placeholder cũ (q-hs-1, q-hs-2) đã được thay thế bằng bộ câu hỏi chính thức
    state.questions = JSON.parse(savedQues).filter(q => q.id !== "q-hs-1" && q.id !== "q-hs-2");
    // Chuyển các câu hỏi cũ sang mã bài học mới nếu có
    state.questions.forEach(q => {
      if (q.lessonId === "hs-enzym") q.lessonId = "hs-acid-citric";
      if (q.lessonId === "hs-glucid-lipid") q.lessonId = "hs-glucid";
      if (q.lessonId === "hs-protid-gan") q.lessonId = "hs-gan";
    });
    // Tự động gộp các câu hỏi mới hoặc cập nhật từ file data.js khi DATA_REVISION thay đổi
    const existingIdxMap = new Map(state.questions.map((q, idx) => [q.id, idx]));
    DEFAULT_QUESTIONS.forEach(defQ => {
      const exIdx = existingIdxMap.get(defQ.id);
      if (exIdx === undefined) {
        existingIdxMap.set(defQ.id, state.questions.length);
        state.questions.push(JSON.parse(JSON.stringify(defQ)));
      } else if (revChanged && !state.questions[exIdx].userEdited) {
        state.questions[exIdx] = JSON.parse(JSON.stringify(defQ));
      }
    });
  } else {
    state.questions = JSON.parse(JSON.stringify(DEFAULT_QUESTIONS));
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

  document.documentElement.setAttribute("data-theme", savedTheme);
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

  // In exam mode answers stay mutable until submission, so return to exact saved question
  if (mode === "exam" && savedIdx !== -1) {
    return savedIdx;
  }

  // In tutor mode, land on savedIdx if unanswered; otherwise advance to next unanswered question
  if (savedIdx !== -1 && answers[questions[savedIdx].id] === undefined) {
    return savedIdx;
  }

  const nextUnanswered = findFirstUnansweredIndex(questions, answers, savedIdx !== -1 ? savedIdx + 1 : 0);
  if (nextUnanswered !== -1) return nextUnanswered;

  return savedIdx !== -1 ? savedIdx : 0;
}

function buildOrderedQuestionsFromSession(availableQuestions, savedQuestionIds) {
  if (!Array.isArray(savedQuestionIds) || savedQuestionIds.length === 0) {
    return availableQuestions;
  }
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
      if (!firstPartialKey && answeredCount < lessonQ.length) {
        firstPartialKey = key;
      }
    });
  });
  if (!state.lastSessionKey && firstPartialKey) {
    state.lastSessionKey = firstPartialKey;
  }
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
    if (typeof ch === "number" && ch >= 0 && ch < q.options.length) {
      validAnswers[q.id] = ch;
    }
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
  const isDone = state.quiz.mode === "exam"
    ? Boolean(state.quiz.submitted)
    : answeredCount >= totalCount;

  if (answeredCount > 0 && !isDone) {
    state.lastSessionKey = key;
  } else if (state.lastSessionKey === key) {
    state.lastSessionKey = null;
  }
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

// ================= NAVIGATION & RENDER =================
function renderSidebar() {
  const navContainer = document.getElementById("sidebar-nav");
  const basicSubjects = state.curriculum.filter(s => s.group === "Cơ bản");
  const specSubjects = state.curriculum.filter(s => s.group !== "Cơ bản");

  const renderItem = (subj) => {
    const count = state.questions.filter(q => q.subjectId === subj.id).length;
    const isActive = state.currentView === "subject" && state.activeSubjectId === subj.id;
    return `
      <div class="nav-item ${isActive ? "active" : ""}" onclick="openSubject('${subj.id}')">
        <div class="nav-item-left">
          <span>${subj.icon}</span>
          <span>${subj.name}</span>
        </div>
        <span class="badge-count">${count} câu</span>
      </div>
    `;
  };

  navContainer.innerHTML = `
    <div class="nav-section">
      <div class="nav-section-title">Quản trị & Tổng quan</div>
      <div class="nav-item ${state.currentView === "dashboard" ? "active" : ""}" onclick="openDashboard()">
        <div class="nav-item-left"><span>🏠</span><span>Bảng điều khiển</span></div>
      </div>
      <div class="nav-item ${state.currentView === "question-bank" ? "active" : ""}" onclick="openQuestionBank()">
        <div class="nav-item-left"><span>📚</span><span>Quản lý Ngân hàng câu hỏi</span></div>
        <span class="badge-count">${state.questions.length}</span>
      </div>
    </div>

    <div class="nav-section">
      <div class="nav-section-title">Khối Cơ Bản (${basicSubjects.length} môn)</div>
      ${basicSubjects.map(renderItem).join("")}
    </div>

    <div class="nav-section">
      <div class="nav-section-title">Khối Chuyên Ngành (${specSubjects.length} môn)</div>
      ${specSubjects.map(renderItem).join("")}
    </div>
  `;
}

function openDashboard() {
  stopTimer();
  state.currentView = "dashboard";
  state.activeSubjectId = null;
  renderSidebar();
  renderMain();
}

function openSubject(subjectId) {
  stopTimer();
  state.currentView = "subject";
  state.activeSubjectId = subjectId;
  renderSidebar();
  renderMain();
}

function openQuestionBank(filterSubjectId = state.bankFilterSubject, filterLessonId = "all") {
  stopTimer();
  state.currentView = "question-bank";
  state.bankFilterSubject = filterSubjectId || "all";
  state.bankFilterLesson = filterLessonId || "all";
  renderSidebar();
  renderMain();
}

function renderMain() {
  const mainEl = document.getElementById("main-content");
  const topTitle = document.getElementById("topbar-title");

  if (state.currentView === "dashboard") {
    topTitle.innerHTML = `<span>🎯 Hệ thống Ôn thi Bác sĩ Nội trú (Quản trị toàn quyền)</span>`;
    mainEl.innerHTML = renderDashboardHTML();
  } else if (state.currentView === "subject") {
    const subj = state.curriculum.find(s => s.id === state.activeSubjectId);
    if (!subj) return openDashboard();
    topTitle.innerHTML = `<span>${subj.icon} ${subj.name}</span> <span class="group-tag">${subj.group}</span>`;
    mainEl.innerHTML = renderSubjectHTML(subj);
  } else if (state.currentView === "quiz") {
    topTitle.innerHTML = `<span>📝 ${state.quiz.title}</span> <span class="group-tag">${state.quiz.mode === "tutor" ? "Active Recall (Giải thích ngay)" : "Thi thử bấm giờ"}</span>`;
    mainEl.innerHTML = renderQuizHTML();
  } else if (state.currentView === "question-bank") {
    topTitle.innerHTML = `<span>📚 Quản trị Ngân hàng Câu hỏi (${state.questions.length} câu)</span>`;
    mainEl.innerHTML = renderQuestionBankHTML();
  }
}

// ================= VIEW 1: DASHBOARD =================
function renderDashboardHTML() {
  const totalQ = state.questions.length;
  const answeredIds = Object.keys(state.history);
  const answeredCount = answeredIds.filter(id => state.questions.some(q => q.id === id)).length;
  const correctCount = answeredIds.filter(id => state.history[id]?.isCorrect && state.questions.some(q => q.id === id)).length;
  const wrongCount = answeredCount - correctCount;
  const accuracy = answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0;

  const basicSubjects = state.curriculum.filter(s => s.group === "Cơ bản");
  const specSubjects = state.curriculum.filter(s => s.group !== "Cơ bản");

  const renderSubjectCard = (subj) => {
    const subjQuestions = state.questions.filter(q => q.subjectId === subj.id);
    const done = subjQuestions.filter(q => state.history[q.id]).length;
    const right = subjQuestions.filter(q => state.history[q.id]?.isCorrect).length;
    const pct = subjQuestions.length > 0 ? Math.round((done / subjQuestions.length) * 100) : 0;

    return `
      <div class="subject-card" onclick="openSubject('${subj.id}')">
        <div>
          <div class="subject-card-top" style="justify-content:space-between;">
            <div style="display:flex; gap:14px; align-items:flex-start;">
              <div class="subject-icon" style="background-color: ${subj.color}18; color: ${subj.color}">
                ${subj.icon}
              </div>
              <div class="subject-info">
                <h3>${subj.name}</h3>
                <p>${subj.description}</p>
              </div>
            </div>
            <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); openSubjectModal('${subj.id}')" title="Sửa tên/mô tả môn học">✏️</button>
          </div>
          <div class="progress-bar-wrap">
            <div class="progress-bar-fill" style="width: ${pct}%; background-color: ${subj.color}"></div>
          </div>
        </div>
        <div class="subject-meta">
          <span>📑 <strong>${subj.lessons.length}</strong> bài nhỏ</span>
          <span>❓ <strong>${subjQuestions.length}</strong> câu hỏi</span>
          <span>✅ Đúng: <strong>${right}/${done}</strong></span>
        </div>
      </div>
    `;
  };

  const lastBanner = getLastActiveSessionBannerData();
  const resumeBannerHTML = lastBanner ? `
    <div class="resume-banner">
      <div class="resume-banner-info">
        <div><strong>📌 Tiếp tục bài đang làm dở:</strong> ${escapeHTML(lastBanner.title)}</div>
        <div class="resume-banner-sub">Đã làm <strong>${lastBanner.answeredCount}/${lastBanner.totalCount}</strong> câu (${lastBanner.mode === "tutor" ? "Luyện tập" : "Thi thử"}) • Tiếp tục từ <strong>Câu ${lastBanner.nextQuestionNum}</strong></div>
      </div>
      <button class="btn btn-sm btn-primary" onclick="resumeLastSession()">▶️ Làm tiếp ngay</button>
    </div>
  ` : "";

  return `
    <div class="stats-grid">
      <div class="stat-card">
        <span class="stat-label">Tổng số câu hỏi</span>
        <span class="stat-value">${totalQ}</span>
        <span class="stat-sub">Trên ${state.curriculum.length} môn thi BSNT</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Tiến độ đã làm</span>
        <span class="stat-value">${answeredCount} / ${totalQ}</span>
        <span class="stat-sub">Hoàn thành ${totalQ ? Math.round((answeredCount / totalQ) * 100) : 0}% ngân hàng</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Tỷ lệ chính xác</span>
        <span class="stat-value" style="color: var(--success)">${accuracy}%</span>
        <span class="stat-sub">Đúng ${correctCount} câu / Sai ${wrongCount} câu</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Ôn tập mục tiêu</span>
        <div style="display:flex; gap:8px; margin-top:6px; flex-wrap:wrap;">
          <button class="btn btn-sm btn-outline" onclick="startFilteredQuiz('wrong')">🔁 Câu sai (${wrongCount})</button>
          <button class="btn btn-sm btn-outline" onclick="startFilteredQuiz('bookmark')">⭐ Đánh dấu (${state.bookmarks.length})</button>
        </div>
      </div>
    </div>

    ${resumeBannerHTML}

    <div class="section-header">
      <h2>🔬 Khối Môn Cơ Bản <span class="group-tag">${basicSubjects.map(s => s.name).join(" • ")}</span></h2>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-sm btn-outline" onclick="openSubjectModal(null, 'Cơ bản')">➕ Thêm môn Cơ bản</button>
        <button class="btn btn-sm btn-primary" onclick="startGroupQuiz('Cơ bản', 'exam')">⏱️ Thi thử Khối Cơ bản</button>
      </div>
    </div>
    <div class="subject-grid">
      ${basicSubjects.map(renderSubjectCard).join("")}
    </div>

    <div class="section-header">
      <h2>☯️ Khối Môn Chuyên Ngành <span class="group-tag">${specSubjects.map(s => s.name).join(" • ")}</span></h2>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-sm btn-outline" onclick="openSubjectModal(null, 'Chuyên ngành')">➕ Thêm môn Chuyên ngành</button>
        <button class="btn btn-sm btn-primary" onclick="startGroupQuiz('Chuyên ngành', 'exam')">⏱️ Thi thử Khối Chuyên ngành</button>
      </div>
    </div>
    <div class="subject-grid">
      ${specSubjects.map(renderSubjectCard).join("")}
    </div>
  `;
}

// ================= VIEW 2: SUBJECT & LESSONS (FULL CRUD) =================
function renderSubjectHTML(subj) {
  const allSubjQ = state.questions.filter(q => q.subjectId === subj.id);

  const lessonsHTML = subj.lessons.map((lesson, idx) => {
    const lessonQ = allSubjQ.filter(q => q.lessonId === lesson.id);
    const doneCount = lessonQ.filter(q => state.history[q.id]).length;
    const correctCount = lessonQ.filter(q => state.history[q.id]?.isCorrect).length;
    const wrongCount = doneCount - correctCount;
    const prog = getLessonSessionProgress(subj.id, lesson.id, lessonQ);

    let tutorBtnLabel = "🧠 Luyện tập";
    if (prog.total > 0 && prog.tutorAnswered > 0 && prog.tutorAnswered < prog.total) {
      tutorBtnLabel = `▶️ Tiếp tục (${prog.tutorAnswered}/${prog.total})`;
    } else if (prog.total > 0 && prog.tutorAnswered >= prog.total) {
      tutorBtnLabel = `✅ Xem lại (${prog.total}/${prog.total})`;
    }
    const examBtnLabel = prog.examInProgress ? `▶️ Thi tiếp (${prog.examAnswered}/${prog.total})` : "⏱️ Thi thử";

    return `
      <div class="lesson-card">
        <div class="lesson-info" style="flex:1;">
          <div style="display:flex; align-items:center; gap:8px;">
            <h4>${lesson.title}</h4>
            <button class="btn btn-sm btn-outline" style="padding:2px 8px; font-size:11.5px;" onclick="openLessonModal('${subj.id}', '${lesson.id}')" title="Sửa tên và mô tả bài học">✏️ Sửa bài</button>
            <button class="btn btn-sm btn-outline" style="padding:2px 7px; font-size:11.5px;" onclick="moveLesson('${subj.id}', ${idx}, -1)" ${idx === 0 ? "disabled" : ""} title="Chuyển lên">↑</button>
            <button class="btn btn-sm btn-outline" style="padding:2px 7px; font-size:11.5px;" onclick="moveLesson('${subj.id}', ${idx}, 1)" ${idx === subj.lessons.length - 1 ? "disabled" : ""} title="Chuyển xuống">↓</button>
            <button class="btn btn-sm btn-outline" style="padding:2px 8px; font-size:11.5px; color:var(--danger);" onclick="deleteLesson('${subj.id}', '${lesson.id}')" title="Xóa bài học này">🗑️ Xóa</button>
          </div>
          <p>${lesson.description || "Chưa có mô tả chi tiết"}</p>
          <div class="lesson-stats-pills">
            <span class="pill">Tổng: <strong>${lessonQ.length}</strong> câu</span>
            <span class="pill">Đã làm: <strong>${doneCount}/${lessonQ.length}</strong></span>
            ${correctCount > 0 ? `<span class="pill correct">Đúng: ${correctCount}</span>` : ""}
            ${wrongCount > 0 ? `<span class="pill wrong">Sai: ${wrongCount}</span>` : ""}
          </div>
        </div>
        <div class="lesson-actions" style="flex-wrap:wrap; justify-content:flex-end;">
          <button class="btn btn-sm btn-outline" onclick="openQuestionBank('${subj.id}', '${lesson.id}')">📋 Sửa DS câu (${lessonQ.length})</button>
          <button class="btn btn-sm btn-outline" onclick="openQuestionModal('${subj.id}', '${lesson.id}')">➕ Thêm câu</button>
          <button class="btn btn-sm btn-outline" onclick="openBulkImportModal('${subj.id}', '${lesson.id}')">📥 Nhập lô</button>
          <button class="btn btn-sm btn-primary" onclick="startLessonQuiz('${subj.id}', '${lesson.id}', 'tutor')">${tutorBtnLabel}</button>
          ${prog.tutorAnswered > 0 ? `<button class="btn btn-sm btn-outline" onclick="restartLessonQuiz('${subj.id}', '${lesson.id}', 'tutor')" title="Bắt đầu làm lại bài này từ câu 1">🔄 Làm lại</button>` : ""}
          <button class="btn btn-sm btn-outline" onclick="startLessonQuiz('${subj.id}', '${lesson.id}', 'exam')">${examBtnLabel}</button>
        </div>
      </div>
    `;
  }).join("");

  const subjTutorSess = state.sessions[getSessionKey("subject", { subjectId: subj.id, mode: "tutor" })];
  const subjTutorDone = subjTutorSess ? allSubjQ.filter(q => typeof subjTutorSess.answers?.[q.id] === "number").length : 0;
  const subjTutorLabel = subjTutorDone > 0 && subjTutorDone < allSubjQ.length
    ? `▶️ Tiếp tục toàn môn (${subjTutorDone}/${allSubjQ.length})`
    : `🚀 Luyện toàn môn (${allSubjQ.length} câu)`;

  return `
    <div class="subject-banner">
      <div>
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:4px;">
          <h2 style="font-size:20px;">${subj.icon} Môn ${subj.name}</h2>
          <button class="btn btn-sm btn-outline" onclick="openSubjectModal('${subj.id}')">✏️ Sửa môn</button>
          <button class="btn btn-sm btn-outline" style="color:var(--danger);" onclick="deleteSubject('${subj.id}')">🗑️ Xóa môn</button>
        </div>
        <p style="color:var(--text-muted); font-size:14px;">${subj.description} • Gồm <strong>${subj.lessons.length}</strong> bài nhỏ & <strong>${allSubjQ.length}</strong> câu hỏi.</p>
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <button class="btn btn-outline" onclick="openLessonModal('${subj.id}')">📁 + Thêm bài nhỏ mới</button>
        <button class="btn btn-outline" onclick="openBulkImportModal('${subj.id}')">📥 Nhập nhanh nhiều câu</button>
        <button class="btn btn-primary" onclick="startSubjectQuiz('${subj.id}', 'tutor')">${subjTutorLabel}</button>
        <button class="btn btn-outline" onclick="startSubjectQuiz('${subj.id}', 'exam')">⏱️ Thi thử môn này</button>
      </div>
    </div>

    <div class="lesson-list">
      ${lessonsHTML || `<div class="stat-card" style="text-align:center; padding:32px;">Môn này chưa có bài nhỏ nào. Hãy bấm <strong>📁 + Thêm bài nhỏ mới</strong> để bắt đầu!</div>`}
    </div>
  `;
}

// ================= VIEW 3: QUIZ ENGINE (WITH LIVE IN-QUIZ EDIT) =================
function startLessonQuiz(subjectId, lessonId, mode) {
  const subj = state.curriculum.find(s => s.id === subjectId);
  const lesson = subj?.lessons.find(l => l.id === lessonId);
  if (!subj || !lesson) return;
  const qs = state.questions.filter(q => q.subjectId === subjectId && q.lessonId === lessonId);
  if (qs.length === 0) {
    alert("Bài học này hiện chưa có câu hỏi. Hãy bấm '➕ Thêm câu' hoặc '📥 Nhập lô' để thêm câu hỏi!");
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
  if (!subj || !lesson || qs.length === 0) return;
  if (!confirm(`Làm lại "${lesson.title}" từ câu 1? (Các lựa chọn đang lưu của phiên này sẽ được đặt lại)`)) return;
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
  if (qs.length === 0) {
    alert("Môn học này hiện chưa có câu hỏi.");
    return;
  }
  const sessionKey = getSessionKey("subject", { subjectId, mode });
  const existing = state.sessions[sessionKey];
  const hasResumableOrder = existing && !(mode === "exam" && existing.submitted) && Array.isArray(existing.questionIds);
  const orderedQs = hasResumableOrder ? qs : shuffleArray([...qs]);
  launchQuiz(`Tổng hợp môn ${subj.name}`, orderedQs, mode, {
    sessionKey,
    sessionMeta: { kind: "subject", subjectId, preserveLiveOrder: false }
  });
}

function startGroupQuiz(groupName, mode) {
  const subjectIds = state.curriculum.filter(s => s.group === groupName).map(s => s.id);
  const qs = state.questions.filter(q => subjectIds.includes(q.subjectId));
  if (qs.length === 0) {
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
    title = "Ôn tập các câu đã đánh dấu ⭐";
  }
  if (qs.length === 0) {
    alert(type === "wrong" ? "Tuyệt vời! Hiện không có câu nào làm sai cần ôn lại." : "Bạn chưa đánh dấu ⭐ câu hỏi nào.");
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
          if (mode === "tutor" || existing.revealed?.[qId]) {
            revealed[qId] = true;
          }
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
      // Khôi phục từ lịch sử làm bài nếu người dùng đã làm trước khi có bộ nhớ phiên
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

  renderSidebar();
  renderMain();
}

function restartCurrentQuiz() {
  if (!state.quiz.questions.length) return;
  const answeredCount = Object.keys(state.quiz.answers).length;
  if (answeredCount > 0 && answeredCount < state.quiz.questions.length) {
    if (!confirm("Bạn muốn làm lại đề này từ câu 1? Tiến độ đang làm dở của phiên này sẽ được đặt lại.")) return;
  }
  const title = state.quiz.title;
  const mode = state.quiz.mode;
  const sessionKey = state.quiz.sessionKey;
  const sessionMeta = state.quiz.sessionMeta ? { ...state.quiz.sessionMeta } : null;
  let freshQuestions = [...state.quiz.questions];
  if (sessionMeta && !sessionMeta.preserveLiveOrder) {
    freshQuestions = shuffleArray(freshQuestions);
  }
  launchQuiz(title, freshQuestions, mode, {
    sessionKey,
    sessionMeta,
    forceFresh: true
  });
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
  if (!state.quiz.questions.length) {
    openDashboard();
    return "";
  }
  const qObj = state.quiz.questions[state.quiz.currentIndex];
  const subj = state.curriculum.find(s => s.id === qObj.subjectId);
  const lesson = subj?.lessons.find(l => l.id === qObj.lessonId);
  const userChoice = state.quiz.answers[qObj.id];
  const isRevealed = state.quiz.mode === "tutor" ? state.quiz.revealed[qObj.id] : state.quiz.submitted;
  const isBookmarked = state.bookmarks.includes(qObj.id);
  const isFlagged = !!state.quiz.flagged[qObj.id];

  const letters = ["A", "B", "C", "D"];

  const optionsHTML = qObj.options.map((optText, idx) => {
    let cls = "option-btn";
    if (isRevealed) {
      if (idx === qObj.correctIndex) cls += " correct";
      else if (idx === userChoice && userChoice !== qObj.correctIndex) cls += " wrong";
    } else if (userChoice === idx) {
      cls += " selected";
    }

    return `
      <button class="${cls}" onclick="selectOption(${idx})" ${isRevealed && state.quiz.mode === "tutor" ? "disabled" : ""}>
        <span class="option-letter">${letters[idx]}</span>
        <span>${escapeHTML(optText)}</span>
      </button>
    `;
  }).join("");

  const paletteHTML = state.quiz.questions.map((item, idx) => {
    let pCls = "palette-item";
    if (idx === state.quiz.currentIndex) pCls += " current";
    const ans = state.quiz.answers[item.id];
    const rev = state.quiz.mode === "tutor" ? state.quiz.revealed[item.id] : state.quiz.submitted;
    if (rev) {
      if (ans === item.correctIndex) pCls += " correct";
      else pCls += " wrong";
    } else if (ans !== undefined) {
      pCls += " answered";
    }
    if (state.quiz.flagged[item.id]) pCls += " flagged";

    return `<div class="${pCls}" onclick="jumpToQuestion(${idx})">${idx + 1}</div>`;
  }).join("");

  let scoreSummaryHTML = "";
  if (state.quiz.submitted || (state.quiz.mode === "tutor" && Object.keys(state.quiz.revealed).length === state.quiz.questions.length)) {
    const total = state.quiz.questions.length;
    const right = state.quiz.questions.filter(q => state.quiz.answers[q.id] === q.correctIndex).length;
    const score10 = ((right / total) * 10).toFixed(2);
    scoreSummaryHTML = `
      <div style="background:var(--success-soft); border:1px solid var(--success); padding:14px 18px; border-radius:10px; margin-bottom:18px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <strong style="color:var(--success); font-size:16px;">🎉 Kết quả: Đúng ${right}/${total} câu (${Math.round((right/total)*100)}%) — Điểm hệ 10: ${score10} điểm</strong>
        </div>
        <button class="btn btn-sm btn-primary" onclick="restartCurrentQuiz()">🔄 Làm lại đề này</button>
      </div>
    `;
  }

  const answeredInSession = Object.keys(state.quiz.answers).length;
  const nextUnansweredIdx = state.quiz.mode === "tutor" && userChoice !== undefined
    ? findFirstUnansweredIndex(state.quiz.questions, state.quiz.answers, state.quiz.currentIndex + 1)
    : -1;

  return `
    ${scoreSummaryHTML}
    <div class="quiz-layout">
      <div class="quiz-card">
        <div class="quiz-header">
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <span class="question-number">Câu ${state.quiz.currentIndex + 1} / ${state.quiz.questions.length}</span>
            <span style="font-size:13px; color:var(--text-muted);">${subj ? subj.name : ""} • ${lesson ? lesson.title : ""}</span>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn btn-sm btn-outline" onclick="openQuestionModal(null, null, '${qObj.id}')" title="Sửa trực tiếp đề, đáp án hoặc thêm ghi chú giải thích ngay lập tức">
              ✏️ Sửa câu này
            </button>
            <button class="btn btn-sm btn-outline" onclick="toggleFlag('${qObj.id}')">
              ${isFlagged ? "🚩 Đã gắn cờ" : "🏳️ Gắn cờ (F)"}
            </button>
            <button class="btn btn-sm btn-outline" onclick="toggleBookmark('${qObj.id}')">
              ${isBookmarked ? "⭐ Đã lưu" : "☆ Lưu câu khó"}
            </button>
          </div>
        </div>

        <div class="question-stem">${escapeHTML(qObj.question)}</div>

        <div class="options-list">
          ${optionsHTML}
        </div>

        ${isRevealed ? `
          <div class="explanation-box">
            <div class="explanation-title" style="justify-content:space-between;">
              <span>💡 Giải thích cơ chế & Biện luận đáp án (Đáp án đúng: ${letters[qObj.correctIndex]})</span>
              <button class="btn btn-sm btn-outline" style="padding:2px 8px; font-size:12px;" onclick="openQuestionModal(null, null, '${qObj.id}')">✏️ Sửa/Thêm ghi chú giải thích</button>
            </div>
            <div>${formatMarkdownSimple(qObj.explanation || "Chưa có giải thích chi tiết. Bạn có thể bấm '✏️ Sửa/Thêm ghi chú giải thích' để tự ghi chú lại.")}</div>
          </div>
        ` : ""}

        <div class="quiz-footer">
          <button class="btn btn-outline" onclick="prevQuestion()" ${state.quiz.currentIndex === 0 ? "disabled" : ""}>⬅️ Câu trước</button>
          <span class="kbd-hint">Phím tắt: <strong>1-4</strong> / <strong>A-D</strong> chọn • <strong>←/→</strong> chuyển câu • <strong>F</strong> gắn cờ • <strong>E</strong> sửa nhanh</span>
          <button class="btn btn-primary" onclick="nextQuestion()" ${state.quiz.currentIndex === state.quiz.questions.length - 1 ? "disabled" : ""}>Câu tiếp theo ➡️</button>
        </div>
      </div>

      <div class="palette-card">
        ${state.quiz.mode === "exam" ? `
          <div class="timer-box">
            <div style="font-size:12px; color:var(--text-muted);">Thời gian còn lại</div>
            <div class="timer-value" id="quiz-timer-display">${formatTime(state.quiz.timerSeconds)}</div>
          </div>
        ` : ""}
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong style="font-size:14px;">Bảng câu hỏi</strong>
          <span style="font-size:12px; color:var(--text-muted);">Đã làm: ${answeredInSession}/${state.quiz.questions.length}</span>
        </div>

        <div class="palette-grid">
          ${paletteHTML}
        </div>

        <div style="display:flex; flex-direction:column; gap:8px; margin-top:14px;">
          ${nextUnansweredIdx !== -1 ? `
            <button class="btn btn-primary" style="width:100%;" onclick="jumpToQuestion(${nextUnansweredIdx})">⏭️ Tới câu chưa làm (Câu ${nextUnansweredIdx + 1})</button>
          ` : ""}
          ${state.quiz.mode === "exam" && !state.quiz.submitted ? `
            <button class="btn btn-primary" style="width:100%;" onclick="submitExam()">✅ Nộp bài & Chấm điểm</button>
          ` : ""}
          ${answeredInSession > 0 ? `
            <button class="btn btn-outline" style="width:100%;" onclick="restartCurrentQuiz()">🔄 Làm lại từ đầu</button>
          ` : ""}
          <button class="btn btn-outline" style="width:100%;" onclick="state.activeSubjectId ? openSubject(state.activeSubjectId) : openDashboard()">🔙 Thoát phiên làm bài</button>
          <div style="font-size:11.5px; color:var(--text-muted); text-align:center;">💾 Tiến độ tự động lưu vào trình duyệt</div>
        </div>
      </div>
    </div>
  `;
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
  renderMain();
}

function prevQuestion() {
  if (state.quiz.currentIndex > 0) {
    state.quiz.currentIndex--;
    saveCurrentQuizSession();
    saveState();
    renderMain();
  }
}

function nextQuestion() {
  if (state.quiz.currentIndex < state.quiz.questions.length - 1) {
    state.quiz.currentIndex++;
    saveCurrentQuizSession();
    saveState();
    renderMain();
  }
}

function jumpToQuestion(idx) {
  state.quiz.currentIndex = idx;
  saveCurrentQuizSession();
  saveState();
  renderMain();
}

function toggleFlag(qId) {
  state.quiz.flagged[qId] = !state.quiz.flagged[qId];
  saveCurrentQuizSession();
  saveState();
  renderMain();
}

function toggleBookmark(qId) {
  const idx = state.bookmarks.indexOf(qId);
  if (idx === -1) state.bookmarks.push(qId);
  else state.bookmarks.splice(idx, 1);
  saveState();
  renderMain();
}

// ================= VIEW 4: QUESTION BANK STUDIO (SEARCH, FILTER, EDIT, DUPLICATE, DELETE) =================
function renderQuestionBankHTML() {
  const filterSubj = state.bankFilterSubject || "all";
  const filterLesson = state.bankFilterLesson || "all";
  const searchQ = (state.bankSearchQuery || "").toLowerCase().trim();

  const selectedSubjObj = state.curriculum.find(s => s.id === filterSubj);

  const filtered = state.questions.filter(q => {
    if (filterSubj !== "all" && q.subjectId !== filterSubj) return false;
    if (filterLesson !== "all" && q.lessonId !== filterLesson) return false;
    if (searchQ) {
      const hay = `${q.question} ${q.options.join(" ")} ${q.explanation || ""}`.toLowerCase();
      if (!hay.includes(searchQ)) return false;
    }
    return true;
  });

  const letters = ["A", "B", "C", "D"];

  return `
    <div class="subject-banner" style="flex-direction:column; align-items:stretch; gap:14px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <select class="form-control" style="width:220px;" onchange="openQuestionBank(this.value, 'all')">
            <option value="all" ${filterSubj === "all" ? "selected" : ""}>Tất cả môn (${state.questions.length} câu)</option>
            ${state.curriculum.map(s => `<option value="${s.id}" ${filterSubj === s.id ? "selected" : ""}>${s.icon} ${s.name}</option>`).join("")}
          </select>

          <select class="form-control" style="width:260px;" onchange="openQuestionBank('${filterSubj}', this.value)" ${filterSubj === "all" ? "disabled" : ""}>
            <option value="all" ${filterLesson === "all" ? "selected" : ""}>Tất cả bài học trong môn</option>
            ${selectedSubjObj ? selectedSubjObj.lessons.map(l => `<option value="${l.id}" ${filterLesson === l.id ? "selected" : ""}>${l.title}</option>`).join("") : ""}
          </select>

          <input type="text" class="form-control" style="width:240px;" placeholder="🔍 Tìm từ khóa câu hỏi..." value="${state.bankSearchQuery || ""}" oninput="state.bankSearchQuery = this.value; renderMain();" />
        </div>

        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-primary" onclick="openQuestionModal('${filterSubj === "all" ? "giai-phau" : filterSubj}', '${filterLesson === "all" ? "" : filterLesson}')">➕ Thêm câu hỏi</button>
          <button class="btn btn-outline" onclick="openBulkImportModal('${filterSubj === "all" ? "giai-phau" : filterSubj}', '${filterLesson === "all" ? "" : filterLesson}')">📥 Nhập hàng loạt</button>
          <button class="btn btn-outline" onclick="exportToDataJS()">⚡ Xuất/Lưu vào data.js</button>
        </div>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px; color:var(--text-muted); padding-top:8px; border-top:1px solid var(--border-color);">
        <span>Đang hiển thị: <strong>${filtered.length}</strong> câu hỏi</span>
        ${filtered.length > 0 ? `<button class="btn btn-sm btn-outline" onclick="launchQuiz('Luyện tập danh sách đang lọc', filteredQuestionsFromCurrentBank(), 'tutor')">🚀 Luyện tập ${filtered.length} câu đang lọc</button>` : ""}
      </div>
    </div>

    <div class="lesson-list">
      ${filtered.map((q, idx) => {
        const subj = state.curriculum.find(s => s.id === q.subjectId);
        const lesson = subj?.lessons.find(l => l.id === q.lessonId);
        return `
          <div class="lesson-card" style="align-items:flex-start;">
            <div class="lesson-info" style="flex:1;">
              <div style="font-size:12px; color:var(--primary); font-weight:700; margin-bottom:4px;">
                ${subj ? subj.name : ""} • ${lesson ? lesson.title : ""}
              </div>
              <h4 style="margin-bottom:8px;">Câu ${idx + 1}: ${escapeHTML(q.question)}</h4>
              <div style="font-size:13.5px; display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:8px;">
                ${q.options.map((opt, oIdx) => `
                  <div style="${oIdx === q.correctIndex ? "color:var(--success); font-weight:700;" : "color:var(--text-muted);"}">
                    ${letters[oIdx]}. ${escapeHTML(opt)} ${oIdx === q.correctIndex ? "✓" : ""}
                  </div>
                `).join("")}
              </div>
              <div style="font-size:12.5px; color:var(--text-muted); background:var(--bg-main); padding:8px 12px; border-radius:6px;">
                ${formatMarkdownSimple(q.explanation || "Chưa có giải thích.")}
              </div>
            </div>
            <div class="lesson-actions" style="flex-direction:column; align-items:stretch;">
              <button class="btn btn-sm btn-outline" onclick="openQuestionModal(null, null, '${q.id}')">✏️ Sửa</button>
              <button class="btn btn-sm btn-outline" onclick="duplicateQuestion('${q.id}')">📋 Nhân bản</button>
              <button class="btn btn-sm btn-outline" style="color:var(--danger);" onclick="deleteQuestion('${q.id}')">🗑️ Xóa</button>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

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

// ================= CRUD: SUBJECTS (MÔN HỌC) =================
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
    header.textContent = `✏️ Chỉnh sửa môn: ${subj.name}`;
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
      lessons: [
        { id: `${newId}-b1`, title: "Bài 1: Đại cương & Cơ sở", description: "Kiến thức trọng tâm bài 1" }
      ]
    });
  }

  saveState();
  closeModals();
  renderSidebar();
  renderMain();
}

function deleteSubject(subjectId) {
  const subj = state.curriculum.find(s => s.id === subjectId);
  if (!subj) return;
  const qCount = state.questions.filter(q => q.subjectId === subjectId).length;
  if (!confirm(`Bạn có chắc muốn xóa môn "${subj.name}" (bao gồm ${subj.lessons.length} bài nhỏ và ${qCount} câu hỏi thuộc môn này)?`)) return;

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
}

// ================= CRUD: LESSONS (BÀI HỌC NHỎ) =================
function openLessonModal(subjectId, editLessonId = null) {
  const subj = state.curriculum.find(s => s.id === subjectId);
  if (!subj) return;
  document.getElementById("lesson-modal-subject-id").value = subjectId;
  document.getElementById("lesson-modal-edit-id").value = editLessonId || "";

  if (editLessonId) {
    const lesson = subj.lessons.find(l => l.id === editLessonId);
    document.getElementById("lesson-modal-header").textContent = `✏️ Sửa bài học (${subj.name})`;
    document.getElementById("lesson-title-input").value = lesson ? lesson.title : "";
    document.getElementById("lesson-desc-input").value = lesson ? lesson.description : "";
  } else {
    document.getElementById("lesson-modal-header").textContent = `📁 Thêm bài học mới vào môn ${subj.name}`;
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
    subj.lessons.push({
      id: `${subjectId}-b${Date.now()}`,
      title,
      description
    });
  }

  saveState();
  closeModals();
  renderMain();
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
  renderSidebar();
  renderMain();
}

// ================= CRUD: QUESTIONS (ADD / EDIT / DUPLICATE / DELETE) =================
function openQuestionModal(subjectId = null, lessonId = null, editQuestionId = null) {
  const editInput = document.getElementById("q-edit-id");
  const header = document.getElementById("q-modal-header");
  const subjSelect = document.getElementById("q-subject-select");

  if (editQuestionId) {
    const qObj = state.questions.find(q => q.id === editQuestionId);
    if (!qObj) return;
    header.textContent = "✏️ Chỉnh sửa câu hỏi trắc nghiệm";
    editInput.value = qObj.id;
    subjSelect.innerHTML = state.curriculum.map(s =>
      `<option value="${s.id}" ${s.id === qObj.subjectId ? "selected" : ""}>${s.name}</option>`
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
    header.textContent = "➕ Thêm câu hỏi trắc nghiệm mới";
    editInput.value = "";
    subjSelect.innerHTML = state.curriculum.map(s =>
      `<option value="${s.id}" ${s.id === targetSubjId ? "selected" : ""}>${s.name}</option>`
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
    `<option value="${l.id}" ${l.id === selectedLessonId ? "selected" : ""}>${l.title}</option>`
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
    // Đồng bộ luôn nếu câu hỏi đang nằm trong phiên Quiz hiện tại
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
  renderSidebar();
  renderMain();
}

function duplicateQuestion(qId) {
  const orig = state.questions.find(q => q.id === qId);
  if (!orig) return;
  const copy = JSON.parse(JSON.stringify(orig));
  copy.id = `q-${Date.now()}`;
  copy.question = copy.question + " (Bản sao)";
  state.questions.push(copy);
  saveState();
  renderSidebar();
  renderMain();
  openQuestionModal(null, null, copy.id);
}

function deleteQuestion(qId) {
  if (!confirm("Bạn có chắc muốn xóa câu hỏi này khỏi ngân hàng?")) return;
  state.questions = state.questions.filter(q => q.id !== qId);
  delete state.history[qId];
  state.bookmarks = state.bookmarks.filter(id => id !== qId);
  Object.values(state.sessions).forEach(sess => {
    if (!sess) return;
    if (sess.answers) delete sess.answers[qId];
    if (sess.revealed) delete sess.revealed[qId];
    if (sess.flagged) delete sess.flagged[qId];
    if (Array.isArray(sess.questionIds)) {
      sess.questionIds = sess.questionIds.filter(id => id !== qId);
    }
    if (sess.currentQuestionId === qId) sess.currentQuestionId = null;
  });
  saveState();
  renderSidebar();
  renderMain();
}

// ================= BULK IMPORT =================
function openBulkImportModal(subjectId, lessonId = null) {
  const targetSubjId = subjectId || state.activeSubjectId || state.curriculum[0]?.id;
  const subjSelect = document.getElementById("bulk-subject-select");
  subjSelect.innerHTML = state.curriculum.map(s =>
    `<option value="${s.id}" ${s.id === targetSubjId ? "selected" : ""}>${s.name}</option>`
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
    `<option value="${l.id}" ${l.id === selectedLessonId ? "selected" : ""}>${l.title}</option>`
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
        if (optMatch[1] === "*") {
          correctIndex = options.length;
        }
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
  renderSidebar();
  renderMain();
  alert(`🎉 Đã nhập thành công ${importedCount} câu hỏi!`);
}

function closeModals() {
  document.querySelectorAll(".modal-backdrop").forEach(el => el.classList.remove("open"));
}

// ================= DIRECT SAVE TO DATA.JS & BACKUP JSON =================
async function exportToDataJS() {
  const jsContent =
    `const DATA_REVISION = ${JSON.stringify(new Date().toISOString())};\n\n` +
    `const DEFAULT_CURRICULUM = ${JSON.stringify(state.curriculum, null, 2)};\n\n` +
    `const DEFAULT_QUESTIONS = ${JSON.stringify(state.questions, null, 2)};\n`;

  // Hỗ trợ ghi đè trực tiếp vào file E:\on-thi-bsnt\data.js trên trình duyệt Chrome/Edge
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: "data.js",
        types: [{
          description: "JavaScript Data File",
          accept: { "text/javascript": [".js"] }
        }]
      });
      const writable = await handle.createWritable();
      await writable.write(jsContent);
      await writable.close();
      alert("✅ Đã ghi đè thành công toàn bộ dữ liệu vào file data.js trên ổ cứng!");
      return;
    } catch (err) {
      if (err.name === "AbortError") return;
    }
  }

  // Fallback tải về nếu trình duyệt không hỗ trợ showSaveFilePicker
  const blob = new Blob([jsContent], { type: "text/javascript;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "data.js";
  a.click();
  URL.revokeObjectURL(url);
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
}

function importBackupJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.curriculum && data.questions) {
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
        renderSidebar();
        renderMain();
        alert(`Khôi phục dữ liệu thành công (${state.questions.length} câu hỏi)!`);
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
  if (!confirm("Bạn có muốn xóa lịch sử làm bài để bắt đầu luyện lại từ đầu không? (Câu hỏi và bài học vẫn được giữ nguyên)")) return;
  state.history = {};
  state.sessions = {};
  state.lastSessionKey = null;
  saveState();
  renderMain();
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") || "light";
  const next = cur === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(STORAGE_KEYS.THEME, next);
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ================= KEYBOARD SHORTCUTS =================
document.addEventListener("keydown", (e) => {
  if (state.currentView !== "quiz") return;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
  if (document.querySelector(".modal-backdrop.open")) return;

  const key = e.key.toUpperCase();
  if (key === "1" || key === "A") selectOption(0);
  else if (key === "2" || key === "B") selectOption(1);
  else if (key === "3" || key === "C") selectOption(2);
  else if (key === "4" || key === "D") selectOption(3);
  else if (e.key === "ArrowRight") nextQuestion();
  else if (e.key === "ArrowLeft") prevQuestion();
  else if (key === "F") {
    const qObj = state.quiz.questions[state.quiz.currentIndex];
    if (qObj) toggleFlag(qObj.id);
  } else if (key === "E") {
    const qObj = state.quiz.questions[state.quiz.currentIndex];
    if (qObj) openQuestionModal(null, null, qObj.id);
  }
});

// ================= INIT =================
window.addEventListener("beforeunload", () => {
  if (state.currentView === "quiz" && state.quiz?.sessionKey) {
    saveCurrentQuizSession();
    saveState();
  }
});

window.addEventListener("DOMContentLoaded", () => {
  loadState();
  renderSidebar();
  renderMain();
});
