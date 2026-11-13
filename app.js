import Reveal from 'reveal.js';
import 'reveal.js/reveal.css';
import gsap from 'gsap';
import { courseData, courseMeta } from './data.js';

// ============================================================================
// إدارة الحالة والتخزين المحلي
// ============================================================================

const STORAGE_KEYS = {
  theme: 'fiqh3200_theme_v1',
  memorized: 'fiqh3200_memorized_v1',
  quizScores: 'fiqh3200_quiz_scores_v1',
  studiedProblems: 'fiqh3200_studied_problems_v1'
};

const VIEW_INDEX = {
  map: 0,
  chapter: 1,
  problem: 2,
  flashcards: 3,
  quiz: 4,
  slides: 5
};

const STAGE_META = [
  { id: 1, arabic: '١', title: 'تحرير محل الخلاف', subtitle: 'بيان موضع الاتفاق والخلاف' },
  { id: 2, arabic: '٢', title: 'الأقوال ونسبتها', subtitle: 'أقوال العلماء ونسبة كل قول إلى أصحابه' },
  { id: 3, arabic: '٣', title: 'سبب الخلاف', subtitle: 'بيان أسباب اختلاف العلماء' },
  { id: 4, arabic: '٤', title: 'الراجح', subtitle: 'القول المختار ووجه ترجيحه' },
  { id: 5, arabic: '٥', title: 'ثمرة الخلاف', subtitle: 'الآثار المترتبة على اختلاف الأقوال' }
];

const ARABIC_LETTERS = ['أ', 'ب', 'ج', 'د'];

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // تجاهل أخطاء التخزين في الوضع الخاص
  }
}

const state = {
  currentView: 'map',
  currentChapterId: 1,
  currentProblemId: 'p1',
  currentStage: 1,
  selectedOpinionId: null,
  unitFilter: 'all',
  problemSearch: '',
  memorized: loadJson(STORAGE_KEYS.memorized, {}),
  quizScores: loadJson(STORAGE_KEYS.quizScores, {}),
  studiedProblems: loadJson(STORAGE_KEYS.studiedProblems, {}),
  fcIndex: 0,
  fcFlipped: false,
  fcFilterUnmemorized: false,
  fcCustomOrder: null,
  quizIndex: 0,
  quizAnswers: {},
  quizCompleted: false,
  slideDeckIndex: 0
};

let revealDeck = null;

// ============================================================================
// أدوات مساعدة
// ============================================================================

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toArabicNum(num) {
  const digits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return String(num).replace(/\d/g, (d) => digits[Number(d)]);
}

function getChapter(id = state.currentChapterId) {
  return courseData.find((c) => c.id === id) || courseData[0];
}

function getAvailableChapters() {
  return courseData.filter((c) => c.status === 'available');
}

function getCurrentProblem() {
  const ch = getChapter();
  if (!ch || !ch.problems || !ch.problems.length) return null;
  return ch.problems.find((p) => p.id === state.currentProblemId) || ch.problems[0];
}

function markProblemStudied(problemId) {
  if (!state.studiedProblems[problemId]) {
    state.studiedProblems[problemId] = true;
    saveJson(STORAGE_KEYS.studiedProblems, state.studiedProblems);
  }
}

function getChapterMasteryStats(chapter) {
  if (chapter.status !== 'available') {
    return { memorizedCount: 0, totalCards: 0, studiedCount: 0, totalProblems: 0, bestScore: null };
  }
  const memorizedCount = chapter.flashcards.filter((fc) => Boolean(state.memorized[fc.id])).length;
  const studiedCount = chapter.problems.filter((p) => Boolean(state.studiedProblems[p.id])).length;
  const bestScore = state.quizScores[chapter.id] ?? null;
  return {
    memorizedCount,
    totalCards: chapter.flashcards.length,
    studiedCount,
    totalProblems: chapter.problems.length,
    bestScore
  };
}

// ============================================================================
// الوضع الليلي والنهاري
// ============================================================================

function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEYS.theme);
  if (saved === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem(STORAGE_KEYS.theme, isDark ? 'dark' : 'light');
}

// ============================================================================
// إدارة النوافذ المنبثقة (مقتطف الـ PDF / الدروس القادمة / درج الفهرس)
// ============================================================================

function openQuoteModal({ title, pageNumber, quoteText }) {
  const modal = document.getElementById('quote-modal');
  document.getElementById('quote-modal-title').textContent = title;
  document.getElementById('quote-modal-page').textContent = `ص ${toArabicNum(pageNumber)}`;
  document.getElementById('quote-modal-text').textContent = quoteText;
  modal.hidden = false;

  const card = modal.querySelector('.modal-card');
  gsap.fromTo(card, { opacity: 0, scale: 0.96, y: 10 }, { opacity: 1, scale: 1, y: 0, duration: 0.24, ease: 'power2.out' });
}

function closeQuoteModal() {
  document.getElementById('quote-modal').hidden = true;
}

function openUpcomingModal(chapter) {
  const modal = document.getElementById('upcoming-modal');
  document.getElementById('upcoming-modal-unit').textContent = chapter.unit;
  document.getElementById('upcoming-modal-pages').textContent = `ص ${toArabicNum(chapter.pageStart)} – ${toArabicNum(chapter.pageEnd)}`;
  document.getElementById('upcoming-modal-title').textContent = `الدرس ${chapter.arabicNumber}: ${chapter.title}`;
  document.getElementById('upcoming-modal-summary').textContent = chapter.summaryGoal;
  document.getElementById('upcoming-modal-range').textContent = chapter.problemsRange || 'متنوعة';
  modal.hidden = false;

  const card = modal.querySelector('.modal-card');
  gsap.fromTo(card, { opacity: 0, scale: 0.96, y: 10 }, { opacity: 1, scale: 1, y: 0, duration: 0.24, ease: 'power2.out' });
}

function closeUpcomingModal() {
  document.getElementById('upcoming-modal').hidden = true;
}

function openTocDrawer() {
  renderTocDrawer();
  const drawer = document.getElementById('toc-drawer');
  drawer.hidden = false;
  const panel = drawer.querySelector('.toc-drawer-panel');
  gsap.fromTo(panel, { x: 40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.24, ease: 'power2.out' });
}

function closeTocDrawer() {
  document.getElementById('toc-drawer').hidden = true;
}

function renderTocDrawer() {
  const listEl = document.getElementById('toc-drawer-list');
  listEl.innerHTML = courseData
    .map((ch) => {
      const isCurrent = ch.id === state.currentChapterId && state.currentView !== 'map';
      const isAvail = ch.status === 'available';
      return `
        <button type="button" class="drawer-item ${isCurrent ? 'is-current' : ''}" data-toc-id="${ch.id}">
          <div>
            <span class="drawer-item-title">الدرس ${ch.arabicNumber}: ${escapeHtml(ch.title)}</span>
            <span class="drawer-item-meta">${escapeHtml(ch.unit)} · ص ${toArabicNum(ch.pageStart)} – ${toArabicNum(ch.pageEnd)}</span>
          </div>
          <span class="drawer-item-meta">${isAvail ? 'متاح ←' : 'قريباً'}</span>
        </button>
      `;
    })
    .join('');

  listEl.querySelectorAll('[data-toc-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.getAttribute('data-toc-id'));
      const ch = getChapter(id);
      closeTocDrawer();
      if (ch.status === 'available') {
        openChapter(ch.id);
      } else {
        openUpcomingModal(ch);
      }
    });
  });
}

// ============================================================================
// التنقل عبر Reveal.js + تحديث الشريط العلوي والفرعي
// ============================================================================

function updateNavigationChrome() {
  document.querySelectorAll('.topbar-nav .nav-btn').forEach((btn) => {
    const navTarget = btn.getAttribute('data-nav');
    const isActive =
      navTarget === state.currentView ||
      (navTarget === 'chapter' && state.currentView === 'problem');
    btn.classList.toggle('is-active', isActive);
  });

  const ch = getChapter();
  const breadcrumbEl = document.getElementById('subbar-breadcrumb');
  const progLabelEl = document.getElementById('subbar-progress-label');
  const progFillEl = document.getElementById('subbar-progress-fill');

  if (state.currentView === 'map') {
    breadcrumbEl.textContent = `خريطة المقرر الكاملة · ${toArabicNum(courseMeta.totalLessons)} درساً (${courseMeta.code})`;
    const avail = getAvailableChapters();
    const totalCards = avail.reduce((acc, c) => acc + c.flashcards.length, 0);
    const doneCards = avail.reduce((acc, c) => acc + c.flashcards.filter((f) => state.memorized[f.id]).length, 0);
    const pct = totalCards ? Math.round((doneCards / totalCards) * 100) : 0;
    progLabelEl.textContent = `البطاقات المحفوظة: ${toArabicNum(doneCards)} من ${toArabicNum(totalCards)}`;
    progFillEl.style.width = `${Math.max(12, pct)}%`;
  } else if (state.currentView === 'chapter') {
    breadcrumbEl.textContent = `${ch.unit} · الدرس ${ch.arabicNumber}: ${ch.title}`;
    const stats = getChapterMasteryStats(ch);
    const pct = stats.totalProblems ? Math.round((stats.studiedCount / stats.totalProblems) * 100) : 0;
    progLabelEl.textContent = `المسائل المدروسة: ${toArabicNum(stats.studiedCount)} من ${toArabicNum(stats.totalProblems)}`;
    progFillEl.style.width = `${Math.max(10, pct)}%`;
  } else if (state.currentView === 'problem') {
    const p = getCurrentProblem();
    breadcrumbEl.textContent = `الدرس ${ch.arabicNumber} · مسألة (${toArabicNum(p.number)}): ${p.title}`;
    progLabelEl.textContent = `المرحلة ${toArabicNum(state.currentStage)} من ٥`;
    progFillEl.style.width = `${(state.currentStage / 5) * 100}%`;
  } else if (state.currentView === 'flashcards') {
    breadcrumbEl.textContent = `بطاقات الاستذكار · الدرس ${ch.arabicNumber}: ${ch.shortTitle}`;
    const cards = getFilteredFlashcards();
    const total = cards.length || ch.flashcards.length;
    const current = total ? Math.min(state.fcIndex + 1, total) : 0;
    progLabelEl.textContent = `البطاقة ${toArabicNum(current)} من ${toArabicNum(total)}`;
    progFillEl.style.width = total ? `${(current / total) * 100}%` : '0%';
  } else if (state.currentView === 'quiz') {
    breadcrumbEl.textContent = `الاختبار الذكي · الدرس ${ch.arabicNumber}: ${ch.shortTitle}`;
    const total = ch.quizzes.length;
    const current = state.quizCompleted ? total : Math.min(state.quizIndex + 1, total);
    progLabelEl.textContent = `السؤال ${toArabicNum(current)} من ${toArabicNum(total)}`;
    progFillEl.style.width = `${(current / total) * 100}%`;
  } else if (state.currentView === 'slides') {
    const slides = buildChapterSlides(ch);
    breadcrumbEl.textContent = `${ch.unit} · الدرس ${ch.arabicNumber}: ${ch.title}`;
    const current = Math.min(state.slideDeckIndex + 1, slides.length);
    progLabelEl.textContent = `الشريحة ${toArabicNum(current)} من ${toArabicNum(slides.length)}`;
    progFillEl.style.width = `${(current / slides.length) * 100}%`;
  }
}

function navigateTo(viewName) {
  state.currentView = viewName;
  renderCurrentView();
  updateNavigationChrome();

  const targetIdx = VIEW_INDEX[viewName] ?? 0;
  if (revealDeck) {
    revealDeck.slide(targetIdx);
  }

  const sectionIds = ['view-map', 'view-chapter', 'view-problem', 'view-flashcards', 'view-quiz', 'view-slides'];
  const activeSection = document.getElementById(sectionIds[targetIdx]);
  if (activeSection) {
    const container = activeSection.querySelector('.view-container');
    gsap.fromTo(
      container,
      { opacity: 0, y: 16 },
      { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out', clearProps: 'transform' }
    );
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderCurrentView() {
  switch (state.currentView) {
    case 'map':
      renderMapView();
      break;
    case 'chapter':
      renderChapterView();
      break;
    case 'problem':
      renderProblemView();
      break;
    case 'flashcards':
      renderFlashcardsView();
      break;
    case 'quiz':
      renderQuizView();
      break;
    case 'slides':
      renderSlideDeckView();
      break;
    default:
      renderMapView();
  }
}

function openChapter(chapterId) {
  const ch = getChapter(chapterId);
  if (ch.status !== 'available') {
    openUpcomingModal(ch);
    return;
  }
  state.currentChapterId = ch.id;
  state.problemSearch = '';
  state.currentProblemId = ch.problems[0]?.id || 'p1';
  navigateTo('chapter');
}

function openProblem(problemId, stage = 1) {
  state.currentProblemId = problemId;
  state.currentStage = stage;
  state.selectedOpinionId = null;
  markProblemStudied(problemId);
  navigateTo('problem');
}

function openFlashcards(chapterId = state.currentChapterId) {
  const ch = getChapter(chapterId);
  if (ch.status !== 'available') {
    openUpcomingModal(ch);
    return;
  }
  state.currentChapterId = ch.id;
  state.fcIndex = 0;
  state.fcFlipped = false;
  state.fcFilterUnmemorized = false;
  state.fcCustomOrder = null;
  navigateTo('flashcards');
}

function openQuiz(chapterId = state.currentChapterId) {
  const ch = getChapter(chapterId);
  if (ch.status !== 'available') {
    openUpcomingModal(ch);
    return;
  }
  state.currentChapterId = ch.id;
  state.quizIndex = 0;
  state.quizAnswers = {};
  state.quizCompleted = false;
  navigateTo('quiz');
}

function openSlideDeck(chapterId = state.currentChapterId) {
  const ch = getChapter(chapterId);
  if (ch.status !== 'available') {
    openUpcomingModal(ch);
    return;
  }
  state.currentChapterId = ch.id;
  state.slideDeckIndex = 0;
  navigateTo('slides');
}

// ============================================================================
// ١. لوحة خريطة المقرر (Candy Crush-style SVG Winding Map)
// ============================================================================

function renderMapView() {
  const root = document.getElementById('map-view-root');
  const availChapters = getAvailableChapters();
  const totalProblemsAvail = availChapters.reduce((s, c) => s + c.problems.length, 0);
  const totalCardsAvail = availChapters.reduce((s, c) => s + c.flashcards.length, 0);
  const memorizedTotal = availChapters.reduce(
    (s, c) => s + c.flashcards.filter((fc) => state.memorized[fc.id]).length,
    0
  );

  const filteredChapters =
    state.unitFilter === 'all'
      ? courseData
      : courseData.filter((ch) => ch.unit === state.unitFilter);

  const positions = ['pos-right', 'pos-center', 'pos-left', 'pos-center'];
  let lastUnit = '';

  const nodesHtml = filteredChapters
    .map((ch, idx) => {
      const showUnitBanner = ch.unit !== lastUnit;
      lastUnit = ch.unit;
      const posClass = positions[idx % positions.length];
      const isAvail = ch.status === 'available';
      const stats = getChapterMasteryStats(ch);
      const footerInfo = isAvail
        ? `${toArabicNum(ch.problems.length)} مسألة خلافية · ${toArabicNum(stats.memorizedCount)}/${toArabicNum(stats.totalCards)} بطاقة`
        : `${escapeHtml(ch.problemsRange || 'محتوى قادم')}`;

      return `
        ${
          showUnitBanner
            ? `<div class="unit-divider-banner">${escapeHtml(ch.unit)} · ${
                ch.unit === 'كتاب الطهارة' ? 'الدروس ١ – ١٠ (ص ٧ – ٢٣٣)' : 'الدروس ١١ – ١٦ (ص ٢٣٤ – ٣٤٩)'
              }</div>`
            : ''
        }
        <div class="map-node-row ${posClass}">
          <button type="button" class="map-node-card ${isAvail ? 'is-available' : 'is-upcoming'}" data-map-chapter="${ch.id}">
            <div class="node-medallion" data-medallion-id="${ch.id}">
              <span>${ch.arabicNumber}</span>
            </div>
            <div class="node-body">
              <div class="node-meta">الدرس ${ch.arabicNumber} · ص ${toArabicNum(ch.pageStart)} – ${toArabicNum(ch.pageEnd)}</div>
              <h3 class="node-title">${escapeHtml(ch.title)}</h3>
              <div class="node-footer-line">
                <span>${footerInfo}</span>
                <span class="node-action-arrow">${isAvail ? 'ابدأ الدراسة ←' : 'معاينة'}</span>
              </div>
            </div>
          </button>
        </div>
      `;
    })
    .join('');

  root.innerHTML = `
    <div class="map-hero-card">
      <div class="map-hero-info">
        <div class="meta-line">${escapeHtml(courseMeta.code)} · ${escapeHtml(courseMeta.subtitle)}</div>
        <h1 class="map-hero-title">خريطة مقرر فقه العبادات ١</h1>
        <p class="map-hero-desc">
          مسار تعليمي تفاعلي يغطي فهرس المقرر كاملاً (١٦ درساً من ص ١ إلى ص ٣٤٩). اختر الدرس الأول أو الثاني لاستعراض التمهيد النظري، وتحرير المسائل الخلافية في خمس مراحل، وبطاقات الاستذكار، والاختبارات الذكية.
        </p>
      </div>
      <div class="map-stats-grid">
        <div class="map-stat-box">
          <span class="map-stat-value">${toArabicNum(courseData.length)}</span>
          <span class="map-stat-label">إجمالي الدروس</span>
        </div>
        <div class="map-stat-box">
          <span class="map-stat-value">${toArabicNum(totalProblemsAvail)}</span>
          <span class="map-stat-label">مسألة متاحة حالياً</span>
        </div>
        <div class="map-stat-box">
          <span class="map-stat-value">${toArabicNum(memorizedTotal)}/${toArabicNum(totalCardsAvail)}</span>
          <span class="map-stat-label">بطاقة محفوظة</span>
        </div>
      </div>
    </div>

    <div class="map-toolbar">
      <div class="unit-filter-group" role="tablist" aria-label="تصفية حسب القسم">
        <button type="button" class="unit-filter-btn ${state.unitFilter === 'all' ? 'is-active' : ''}" data-unit-filter="all">جميع الدروس (١٦)</button>
        <button type="button" class="unit-filter-btn ${state.unitFilter === 'كتاب الطهارة' ? 'is-active' : ''}" data-unit-filter="كتاب الطهارة">كتاب الطهارة (١٠)</button>
        <button type="button" class="unit-filter-btn ${state.unitFilter === 'كتاب الصلاة' ? 'is-active' : ''}" data-unit-filter="كتاب الصلاة">كتاب الصلاة (٦)</button>
      </div>
      <div class="map-legend">
        <span class="legend-item"><span class="legend-swatch is-available"></span>متاح بالكامل (الدرسان ١ و ٢)</span>
        <span class="legend-item"><span class="legend-swatch is-upcoming"></span>مجدول في الخريطة (٣ – ١٦)</span>
      </div>
    </div>

    <div class="winding-map-stage" id="winding-map-stage">
      <svg class="winding-svg-layer" id="winding-svg-layer" aria-hidden="true"></svg>
      <div class="winding-nodes-canvas">
        ${nodesHtml}
      </div>
    </div>
  `;

  root.querySelectorAll('[data-unit-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.unitFilter = btn.getAttribute('data-unit-filter');
      renderMapView();
    });
  });

  root.querySelectorAll('[data-map-chapter]').forEach((card) => {
    card.addEventListener('click', () => {
      const id = Number(card.getAttribute('data-map-chapter'));
      openChapter(id);
    });
  });

  requestAnimationFrame(() => {
    drawWindingSvgPath();
    gsap.fromTo(
      root.querySelectorAll('.map-node-card'),
      { opacity: 0, y: 14 },
      { opacity: 1, y: 0, duration: 0.35, stagger: 0.035, ease: 'power2.out', clearProps: 'transform' }
    );
  });
}

function drawWindingSvgPath() {
  const stage = document.getElementById('winding-map-stage');
  const svg = document.getElementById('winding-svg-layer');
  if (!stage || !svg) return;

  const medallions = Array.from(stage.querySelectorAll('.node-medallion'));
  if (medallions.length < 2) {
    svg.innerHTML = '';
    return;
  }

  const stageRect = stage.getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${stageRect.width} ${stageRect.height}`);

  const points = medallions.map((el) => {
    const r = el.getBoundingClientRect();
    return {
      id: Number(el.getAttribute('data-medallion-id')),
      x: r.left - stageRect.left + r.width / 2,
      y: r.top - stageRect.top + r.height / 2
    };
  });

  const buildPath = (pts) => {
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const midY = (p1.y + p2.y) / 2;
      d += ` C ${p1.x.toFixed(1)} ${midY.toFixed(1)}, ${p2.x.toFixed(1)} ${midY.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  };

  const fullD = buildPath(points);
  const availPoints = points.filter((pt) => {
    const ch = courseData.find((c) => c.id === pt.id);
    return ch && ch.status === 'available';
  });
  const activeD = availPoints.length >= 2 ? buildPath(availPoints) : '';

  svg.innerHTML = `
    <path class="winding-path-base" d="${fullD}" />
    <path class="winding-path-dash" d="${fullD}" />
    ${activeD ? `<path class="winding-path-active" id="winding-active-stroke" d="${activeD}" />` : ''}
  `;

  const activeStroke = document.getElementById('winding-active-stroke');
  if (activeStroke && typeof activeStroke.getTotalLength === 'function') {
    const len = activeStroke.getTotalLength();
    gsap.fromTo(
      activeStroke,
      { strokeDasharray: len, strokeDashoffset: len },
      { strokeDashoffset: 0, duration: 0.9, ease: 'power2.out' }
    );
  }
}

// ============================================================================
// ٢. عرض الباب (المقدمة + أزرار التقييم + قائمة المسائل)
// ============================================================================

function renderChapterView() {
  const root = document.getElementById('chapter-view-root');
  const ch = getChapter();
  const stats = getChapterMasteryStats(ch);
  const query = state.problemSearch.trim();

  const filteredProblems = query
    ? ch.problems.filter(
        (p) =>
          p.title.includes(query) ||
          p.category.includes(query) ||
          p.shortSummary.includes(query)
      )
    : ch.problems;

  const introHtml = ch.intro
    .map(
      (sec) => `
      <article class="intro-card">
        <div class="intro-card-head">
          <div>
            <div class="meta-line">تمهيد وتأصيل · الصفحة ${toArabicNum(sec.pageNumber)}</div>
            <h3 class="intro-card-title">${escapeHtml(sec.title)}</h3>
          </div>
          <button type="button" class="quote-btn" data-quote-intro="${escapeHtml(sec.id)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span>عرض مقتطف ص ${toArabicNum(sec.pageNumber)}</span>
          </button>
        </div>
        <p class="intro-card-summary">${escapeHtml(sec.summary)}</p>
        <ul class="intro-points-list">
          ${sec.points.map((pt) => `<li>${escapeHtml(pt)}</li>`).join('')}
        </ul>
      </article>
    `
    )
    .join('');

  const problemsHtml = filteredProblems.length
    ? filteredProblems
        .map(
          (p) => `
        <article class="problem-card">
          <div>
            <div class="problem-card-meta">مسألة (${toArabicNum(p.number)}) · ${escapeHtml(p.category)} · ص ${toArabicNum(p.pageNumber)}</div>
            <h3 class="problem-card-title">${escapeHtml(p.title)}</h3>
            <p class="problem-card-desc">${escapeHtml(p.shortSummary)}</p>
          </div>
          <div>
            <div class="problem-card-rajih">
              <strong>الراجح في المقرر:</strong> ${escapeHtml(p.rajih.chosen)}
            </div>
            <div class="problem-card-actions">
              <button type="button" class="quote-btn" data-quote-problem="${escapeHtml(p.id)}">
                <span>عرض مقتطف ص ${toArabicNum(p.pageNumber)}</span>
              </button>
              <button type="button" class="btn-dark" data-open-problem="${escapeHtml(p.id)}">
                <span>دراسة المسألة ←</span>
              </button>
            </div>
          </div>
        </article>
      `
        )
        .join('')
    : `<div class="intro-card"><p class="intro-card-summary">لا توجد مسائل مطابقة لعبارة البحث.</p></div>`;

  root.innerHTML = `
    <div class="chapter-header-card">
      <div class="chapter-top-row">
        <button type="button" class="back-link-btn" id="ch-back-to-map">
          <span>→ العودة إلى خريطة المقرر</span>
        </button>
        <div class="meta-line" style="margin:0;">الدرس ${ch.arabicNumber} · ${escapeHtml(ch.unit)} · الصفحات: ص ${toArabicNum(ch.pageStart)} – ص ${toArabicNum(ch.pageEnd)}</div>
      </div>

      <h1 class="chapter-title">${escapeHtml(ch.title)}</h1>

      <div class="chapter-goal-box">
        <strong>مدخل الدرس والمقصد العلمي:</strong>
        <span>${escapeHtml(ch.summaryGoal)}</span>
      </div>

      <div class="chapter-eval-bar">
        <button type="button" class="eval-action-btn is-flashcards" id="ch-open-flashcards">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="6" width="16" height="14" rx="2" />
            <path d="M6 2h14a2 2 0 0 1 2 2v12" />
          </svg>
          <div>
            <div>بطاقات الاستذكار (${toArabicNum(ch.flashcards.length)} بطاقة)</div>
            <div class="eval-sub">تم حفظ ${toArabicNum(stats.memorizedCount)} من ${toArabicNum(stats.totalCards)}</div>
          </div>
        </button>

        <button type="button" class="eval-action-btn is-quiz" id="ch-open-quiz">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div>
            <div>الاختبار الذكي (${toArabicNum(ch.quizzes.length)} سؤالاً)</div>
            <div class="eval-sub">${stats.bestScore !== null ? `أعلى نتيجة: ${toArabicNum(stats.bestScore)}%` : 'اختبر فهمك للمسائل والأدلة'}</div>
          </div>
        </button>

        <button type="button" class="eval-action-btn is-slides" id="ch-open-slides">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          <div>
            <div>عرض الشرائح التفاعلي</div>
            <div class="eval-sub">مراجعة الدرس شريحة بشريحة (Reveal.js)</div>
          </div>
        </button>
      </div>
    </div>

    <div class="section-heading-row">
      <div>
        <h2 class="section-heading">أولاً: الخلاصة المنهجية والتأصيل النظري</h2>
        <span class="section-subheading">المادة العلمية التأسيسية خارج الجداول (انقر زر المقتطف لعرض النص الأصلي من المقرر)</span>
      </div>
    </div>
    <div class="intro-cards-stack">
      ${introHtml}
    </div>

    <div class="section-heading-row">
      <div>
        <h2 class="section-heading">ثانياً: المسائل الفقهية المقارنة (${toArabicNum(ch.problems.length)} مسألة)</h2>
        <span class="section-subheading">مستخلصة من جداول المقرر · انقر على أي مسألة لدراسة مراحلها الخمس</span>
      </div>
      <input
        type="search"
        class="problems-search-input"
        id="chapter-problem-search"
        placeholder="ابحث في مسائل الدرس..."
        value="${escapeHtml(state.problemSearch)}"
      />
    </div>
    <div class="problems-grid" id="chapter-problems-grid">
      ${problemsHtml}
    </div>
  `;

  document.getElementById('ch-back-to-map').addEventListener('click', () => navigateTo('map'));
  document.getElementById('ch-open-flashcards').addEventListener('click', () => openFlashcards(ch.id));
  document.getElementById('ch-open-quiz').addEventListener('click', () => openQuiz(ch.id));
  document.getElementById('ch-open-slides').addEventListener('click', () => openSlideDeck(ch.id));

  const searchInput = document.getElementById('chapter-problem-search');
  searchInput.addEventListener('input', (e) => {
    state.problemSearch = e.target.value;
    renderChapterView();
    const restored = document.getElementById('chapter-problem-search');
    if (restored) {
      restored.focus();
      restored.setSelectionRange(restored.value.length, restored.value.length);
    }
  });

  root.querySelectorAll('[data-quote-intro]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const secId = btn.getAttribute('data-quote-intro');
      const sec = ch.intro.find((s) => s.id === secId);
      if (sec) {
        openQuoteModal({ title: sec.title, pageNumber: sec.pageNumber, quoteText: sec.pdfQuote });
      }
    });
  });

  root.querySelectorAll('[data-quote-problem]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pid = btn.getAttribute('data-quote-problem');
      const prob = ch.problems.find((p) => p.id === pid);
      if (prob) {
        openQuoteModal({ title: `مسألة (${toArabicNum(prob.number)}): ${prob.title}`, pageNumber: prob.pageNumber, quoteText: prob.pdfQuote });
      }
    });
  });

  root.querySelectorAll('[data-open-problem]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pid = btn.getAttribute('data-open-problem');
      openProblem(pid, 1);
    });
  });
}

// ============================================================================
// ٣. تفاصيل المسألة وفق الإطار التخطيطي (Wireframe 5-Stage Layout)
// ============================================================================

function renderProblemView() {
  const root = document.getElementById('problem-view-root');
  const ch = getChapter();
  const p = getCurrentProblem();
  if (!p) return;

  const currentIdxInChapter = ch.problems.findIndex((item) => item.id === p.id);
  const nextProblem = ch.problems[currentIdxInChapter + 1] || null;
  const currentStageMeta = STAGE_META.find((s) => s.id === state.currentStage) || STAGE_META[0];

  const sidebarHtml = `
    <aside class="wireframe-sidebar">
      <button type="button" class="sidebar-back-btn" id="wf-back-chapter">
        <span>→ العودة إلى الدرس</span>
      </button>

      <span class="sidebar-section-label">مراحل دراسة المسألة</span>
      <div class="stage-nav-list">
        ${STAGE_META.map(
          (st) => `
          <button
            type="button"
            class="stage-nav-btn ${state.currentStage === st.id ? 'is-active' : ''}"
            data-wf-stage="${st.id}"
          >
            <span class="stage-num">${st.arabic}</span>
            <span>${escapeHtml(st.title)}</span>
          </button>
        `
        ).join('')}
      </div>

      <div class="sidebar-study-topic">
        <span class="sidebar-topic-caption">موضوع الدراسة · ص ${toArabicNum(p.pageNumber)}</span>
        <h4 class="sidebar-topic-title">${escapeHtml(p.title)}</h4>
        <button type="button" class="quote-btn" id="wf-sidebar-quote" style="width:100%; justify-content:center;">
          <span>عرض مقتطف ص ${toArabicNum(p.pageNumber)}</span>
        </button>
      </div>
    </aside>
  `;

  let stageBodyHtml = '';

  if (state.currentStage === 1) {
    // المرحلة ١: تحرير محل الخلاف
    stageBodyHtml = `
      <div class="wf-cards-2col">
        <div class="wf-card">
          <span class="wf-card-kicker">١ / موضع الاتفاق</span>
          <h3 class="wf-card-heading">ما اتفق عليه الفقهاء</h3>
          <p class="wf-card-body">${escapeHtml(p.tahrir.agreement)}</p>
        </div>
        <div class="wf-card is-white">
          <span class="wf-card-kicker">٢ / محل النزاع</span>
          <h3 class="wf-card-heading">نقطة الخلاف المحررة</h3>
          <p class="wf-card-body">${escapeHtml(p.tahrir.disputePoint)}</p>
        </div>
      </div>
      <div class="wf-card is-white">
        <span class="wf-card-kicker">٣ / سؤال المسألة</span>
        <h3 class="wf-card-heading">${escapeHtml(p.tahrir.question)}</h3>
      </div>
      <div class="wf-footer-bar">
        <span class="wf-source-note">مصدر المادة: الجدول الفقهي المرفق — ص ${toArabicNum(p.pageNumber)}</span>
        <button type="button" class="btn-dark" data-goto-stage="2">الأقوال ونسبتها ←</button>
      </div>
    `;
  } else if (state.currentStage === 2) {
    const selectedOp = state.selectedOpinionId
      ? p.opinions.find((o) => o.id === state.selectedOpinionId)
      : null;

    if (selectedOp) {
      // التفرع التفصيلي للدليل ووجه الاستدلال (مطابق لصفحات الوايرفريم ١ - ٣ و ١٠ - ١٢)
      stageBodyHtml = `
        <div style="margin-bottom: 14px;">
          <button type="button" class="back-link-btn" id="wf-back-opinions">
            <span>→ العودة إلى الأقوال ونسبتها</span>
          </button>
        </div>

        <div class="wf-card is-white" style="margin-bottom: 16px;">
          <span class="wf-card-kicker">أدلة ${escapeHtml(selectedOp.label)}</span>
          <h3 class="wf-card-heading">${escapeHtml(selectedOp.ruling)}</h3>
          <p class="wf-card-scholars">نسبة القول: ${escapeHtml(selectedOp.scholars)}</p>
        </div>

        <div class="wf-cards-2col">
          <div class="wf-card">
            <span class="wf-card-kicker">١ / الأدلة</span>
            <h3 class="wf-card-heading">النصوص والأصول المستدل بها</h3>
            <p class="wf-card-body">${escapeHtml(selectedOp.evidence)}</p>
          </div>
          <div class="wf-card is-white">
            <span class="wf-card-kicker">٢ / وجه الاستدلال</span>
            <h3 class="wf-card-heading">وجه الدلالة</h3>
            <p class="wf-card-body">${escapeHtml(selectedOp.inference)}</p>
          </div>
        </div>

        <div class="wf-footer-bar">
          <span class="wf-source-note">مصدر المادة: جدول مسألة (${toArabicNum(p.number)}) — ${escapeHtml(selectedOp.label)} (ص ${toArabicNum(p.pageNumber)})</span>
          <button type="button" class="btn-dark" id="wf-back-opinions-footer">العودة إلى قائمة الأقوال →</button>
        </div>
      `;
    } else {
      // قائمة الأقوال ونسبتها (مطابق لصفحات الوايرفريم ٤ و ١٣)
      stageBodyHtml = `
        <p class="wf-card-body" style="margin-bottom: 16px;">اختر أحد الأقوال الآتية لقراءة أدلته الشرعية ووجه الاستدلال بها:</p>
        <div class="wf-cards-3col">
          ${p.opinions
            .map(
              (op) => `
            <div class="wf-card is-white wf-opinion-card" data-open-opinion="${escapeHtml(op.id)}">
              <div>
                <span class="wf-card-kicker">${escapeHtml(op.label)}</span>
                <h3 class="wf-card-heading">${escapeHtml(op.ruling)}</h3>
                <p class="wf-card-scholars">${escapeHtml(op.scholars)}</p>
                <p class="wf-card-body">${escapeHtml(op.summary)}</p>
              </div>
              <span class="wf-dalil-trigger">عرض الأدلة ←</span>
            </div>
          `
            )
            .join('')}
        </div>
        <div class="wf-footer-bar">
          <span class="wf-source-note">مصدر المادة: جدول مسألة (${toArabicNum(p.number)}) — ص ${toArabicNum(p.pageNumber)}</span>
          <button type="button" class="btn-dark" data-goto-stage="3">سبب الخلاف ←</button>
        </div>
      `;
    }
  } else if (state.currentStage === 3) {
    // المرحلة ٣: سبب الخلاف (مطابق لصفحات الوايرفريم ٩ و ١٨)
    stageBodyHtml = `
      <div class="wf-card" style="margin-bottom: 16px;">
        <span class="wf-card-kicker">١ / منشأ الاختلاف</span>
        <h3 class="wf-card-heading">السبب الرئيس لتنازع الفقهاء</h3>
        <p class="wf-card-body">${escapeHtml(p.cause.origin)}</p>
      </div>
      <div class="wf-cards-2col">
        ${p.cause.details
          .map(
            (det, i) => `
          <div class="wf-card is-white">
            <span class="wf-card-kicker">${toArabicNum(i + 2)} / توجيه الخلاف</span>
            <p class="wf-card-body">${escapeHtml(det)}</p>
          </div>
        `
          )
          .join('')}
      </div>
      <div class="wf-footer-bar">
        <span class="wf-source-note">مصدر المادة: جدول مسألة (${toArabicNum(p.number)}) — سبب الخلاف (ص ${toArabicNum(p.pageNumber)})</span>
        <button type="button" class="btn-dark" data-goto-stage="4">الراجح ←</button>
      </div>
    `;
  } else if (state.currentStage === 4) {
    // المرحلة ٤: الراجح (مطابق لصفحات الوايرفريم ٦ و ١٥)
    stageBodyHtml = `
      <div class="wf-card is-highlight" style="margin-bottom: 16px;">
        <span class="wf-card-kicker">١ / القول المختار في المادة</span>
        <h3 class="wf-card-heading">${escapeHtml(p.rajih.chosen)}</h3>
      </div>
      <div class="wf-cards-2col">
        <div class="wf-card is-white">
          <span class="wf-card-kicker">٢ / وجه الترجيح</span>
          <h3 class="wf-card-heading">التعليل الفقهي والدليلي</h3>
          <p class="wf-card-body">${escapeHtml(p.rajih.reason)}</p>
        </div>
        <div class="wf-card">
          <span class="wf-card-kicker">٣ / الضابط الأصولي أو الفقهي</span>
          <h3 class="wf-card-heading">القاعدة الجامعة</h3>
          <p class="wf-card-body">${escapeHtml(p.rajih.principle)}</p>
        </div>
      </div>
      <div class="wf-footer-bar">
        <span class="wf-source-note">الترجيح منقول من المقرر الدراسي — ص ${toArabicNum(p.pageNumber)}</span>
        <button type="button" class="btn-dark" data-goto-stage="5">ثمرة الخلاف ←</button>
      </div>
    `;
  } else {
    // المرحلة ٥: ثمرة الخلاف + مراجع المسألة (مطابق لصفحات الوايرفريم ٨ و ١٧)
    stageBodyHtml = `
      <div class="wf-cards-3col">
        ${p.fruit
          .map(
            (fr) => `
          <div class="wf-card is-white">
            <span class="wf-card-kicker">${escapeHtml(fr.opinionLabel)}</span>
            <p class="wf-card-body">${escapeHtml(fr.consequence)}</p>
          </div>
        `
          )
          .join('')}
      </div>

      <div class="wf-references-box">
        <h4>مراجع المسألة في المقرر</h4>
        <ul class="wf-references-list">
          ${p.references.map((ref) => `<li>${escapeHtml(ref)}</li>`).join('')}
        </ul>
      </div>

      <div class="wf-footer-bar">
        <button type="button" class="btn-outline" id="wf-done-chapter">→ العودة إلى الدرس</button>
        ${
          nextProblem
            ? `<button type="button" class="btn-dark" data-next-problem="${escapeHtml(nextProblem.id)}">المسألة التالية (${toArabicNum(nextProblem.number)}) ←</button>`
            : `<button type="button" class="btn-emerald is-solid" id="wf-finish-eval">الانتقال إلى بطاقات الاستذكار ←</button>`
        }
      </div>
    `;
  }

  root.innerHTML = `
    <div class="wireframe-layout">
      ${sidebarHtml}
      <div class="wireframe-main">
        <div class="wf-header">
          <div>
            <div class="wf-breadcrumb">الدرس ${ch.arabicNumber} · مسألة (${toArabicNum(p.number)}) · المرحلة ${currentStageMeta.arabic} / ${escapeHtml(currentStageMeta.title)}</div>
            <h2 class="wf-stage-title">${escapeHtml(currentStageMeta.title)}</h2>
            <p class="wf-problem-subtitle">${escapeHtml(p.title)}</p>
          </div>
          <button type="button" class="quote-btn" id="wf-header-quote">
            <span>عرض مقتطف ص ${toArabicNum(p.pageNumber)}</span>
          </button>
        </div>
        <div id="wf-stage-body">
          ${stageBodyHtml}
        </div>
      </div>
    </div>
  `;

  // ربط الأحداث
  document.getElementById('wf-back-chapter').addEventListener('click', () => navigateTo('chapter'));
  document.getElementById('wf-sidebar-quote').addEventListener('click', () => {
    openQuoteModal({ title: `مسألة (${toArabicNum(p.number)}): ${p.title}`, pageNumber: p.pageNumber, quoteText: p.pdfQuote });
  });
  document.getElementById('wf-header-quote').addEventListener('click', () => {
    openQuoteModal({ title: `مسألة (${toArabicNum(p.number)}): ${p.title}`, pageNumber: p.pageNumber, quoteText: p.pdfQuote });
  });

  root.querySelectorAll('[data-wf-stage]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.currentStage = Number(btn.getAttribute('data-wf-stage'));
      state.selectedOpinionId = null;
      renderProblemView();
      updateNavigationChrome();
      gsap.fromTo('#wf-stage-body', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.25, ease: 'power2.out' });
    });
  });

  root.querySelectorAll('[data-goto-stage]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.currentStage = Number(btn.getAttribute('data-goto-stage'));
      state.selectedOpinionId = null;
      renderProblemView();
      updateNavigationChrome();
      gsap.fromTo('#wf-stage-body', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.25, ease: 'power2.out' });
    });
  });

  root.querySelectorAll('[data-open-opinion]').forEach((card) => {
    card.addEventListener('click', () => {
      state.selectedOpinionId = card.getAttribute('data-open-opinion');
      renderProblemView();
      gsap.fromTo('#wf-stage-body', { opacity: 0, x: -12 }, { opacity: 1, x: 0, duration: 0.25, ease: 'power2.out' });
    });
  });

  const backOpinions = document.getElementById('wf-back-opinions');
  const backOpinionsFooter = document.getElementById('wf-back-opinions-footer');
  [backOpinions, backOpinionsFooter].forEach((btn) => {
    if (btn) {
      btn.addEventListener('click', () => {
        state.selectedOpinionId = null;
        renderProblemView();
        gsap.fromTo('#wf-stage-body', { opacity: 0, x: 12 }, { opacity: 1, x: 0, duration: 0.25, ease: 'power2.out' });
      });
    }
  });

  const doneChapter = document.getElementById('wf-done-chapter');
  if (doneChapter) doneChapter.addEventListener('click', () => navigateTo('chapter'));

  const nextBtn = root.querySelector('[data-next-problem]');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      openProblem(nextBtn.getAttribute('data-next-problem'), 1);
    });
  }

  const finishEvalBtn = document.getElementById('wf-finish-eval');
  if (finishEvalBtn) {
    finishEvalBtn.addEventListener('click', () => openFlashcards(ch.id));
  }
}

// ============================================================================
// ٤. وضع بطاقات الاستذكار (Flashcards 3D Flip Mode)
// ============================================================================

function getFilteredFlashcards() {
  const ch = getChapter();
  let cards = state.fcCustomOrder
    ? state.fcCustomOrder.map((id) => ch.flashcards.find((c) => c.id === id)).filter(Boolean)
    : [...ch.flashcards];

  if (state.fcFilterUnmemorized) {
    cards = cards.filter((c) => !state.memorized[c.id]);
  }
  return cards;
}

function renderFlashcardsView() {
  const root = document.getElementById('flashcards-view-root');
  const ch = getChapter();
  const cards = getFilteredFlashcards();
  const totalInChapter = ch.flashcards.length;
  const memorizedCount = ch.flashcards.filter((c) => state.memorized[c.id]).length;

  if (state.fcIndex >= cards.length) {
    state.fcIndex = Math.max(0, cards.length - 1);
  }
  const currentCard = cards[state.fcIndex] || null;

  root.innerHTML = `
    <div class="study-mode-header">
      <div>
        <div class="meta-line">بطاقات الاستذكار · الدرس ${ch.arabicNumber}: ${escapeHtml(ch.shortTitle)}</div>
        <h2 class="study-mode-title">مراجعة المصطلحات والأقوال والأدلة (${toArabicNum(memorizedCount)} / ${toArabicNum(totalInChapter)} محفوظة)</h2>
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <button type="button" class="back-link-btn" id="fc-back-chapter">→ العودة إلى الدرس</button>
        <button type="button" class="btn-dark" id="fc-goto-quiz">الانتقال إلى الاختبار ←</button>
      </div>
    </div>

    <div class="flashcard-controls-bar">
      <div class="unit-filter-group">
        <button type="button" class="unit-filter-btn ${!state.fcFilterUnmemorized ? 'is-active' : ''}" id="fc-filter-all">
          جميع البطاقات (${toArabicNum(totalInChapter)})
        </button>
        <button type="button" class="unit-filter-btn ${state.fcFilterUnmemorized ? 'is-active' : ''}" id="fc-filter-review">
          قيد المراجعة (${toArabicNum(totalInChapter - memorizedCount)})
        </button>
      </div>

      <button type="button" class="btn-outline" id="fc-shuffle-btn">ترتيب عشوائي للبطاقات</button>
    </div>

    ${
      currentCard
        ? `
      <div class="flashcard-stage">
        <div class="flashcard-inner" id="fc-card-inner" role="button" tabindex="0" aria-label="انقر لقلب البطاقة">
          <div class="flashcard-face is-front">
            <div class="fc-top-meta">
              <span>${escapeHtml(currentCard.category)} · ص ${toArabicNum(currentCard.pageNumber)}</span>
              <span>البطاقة ${toArabicNum(state.fcIndex + 1)} من ${toArabicNum(cards.length)}</span>
            </div>
            <div class="fc-body-center">
              <p class="fc-question-text">${escapeHtml(currentCard.front)}</p>
            </div>
            <div class="fc-bottom-hint">
              <span>الوجه الأمامي (السؤال)</span>
              <span>انقر على البطاقة أو اضغط مسافة لقلبها ↻</span>
            </div>
          </div>

          <div class="flashcard-face is-back">
            <div class="fc-top-meta">
              <span>الإجابة المعتمدة · ص ${toArabicNum(currentCard.pageNumber)}</span>
              <button type="button" class="quote-btn" id="fc-quote-trigger">عرض مقتطف ص ${toArabicNum(currentCard.pageNumber)}</button>
            </div>
            <div class="fc-body-center">
              <p class="fc-answer-text">${escapeHtml(currentCard.back)}</p>
            </div>
            <div class="fc-bottom-hint">
              <span>الوجه الخلفي (الخلاصة الفقهية)</span>
              <span>انقر للعودة إلى السؤال ↺</span>
            </div>
          </div>
        </div>
      </div>

      <div class="flashcard-nav-footer">
        <button type="button" class="btn-outline" id="fc-prev-btn" ${state.fcIndex === 0 ? 'disabled' : ''}>→ البطاقة السابقة</button>

        <button type="button" class="btn-emerald ${state.memorized[currentCard.id] ? 'is-solid' : ''}" id="fc-toggle-mem">
          <span>${state.memorized[currentCard.id] ? '✓ تم الحفظ (إلغاء)' : 'تحديد كـ «تم الحفظ»'}</span>
        </button>

        <button type="button" class="btn-dark" id="fc-next-btn" ${state.fcIndex >= cards.length - 1 ? 'disabled' : ''}>البطاقة التالية ←</button>
      </div>
    `
        : `
      <div class="quiz-card-shell" style="text-align:center;">
        <h3 class="wf-card-heading">أحسنت! أتممت حفظ جميع بطاقات هذا الدرس</h3>
        <p class="intro-card-summary">يمكنك عرض جميع البطاقات للمراجعة الشاملة أو الانتقال إلى الاختبار الذكي للدرس.</p>
        <button type="button" class="btn-dark" id="fc-reset-filter">عرض جميع البطاقات</button>
      </div>
    `
    }
  `;

  document.getElementById('fc-back-chapter').addEventListener('click', () => navigateTo('chapter'));
  document.getElementById('fc-goto-quiz').addEventListener('click', () => openQuiz(ch.id));

  document.getElementById('fc-filter-all').addEventListener('click', () => {
    state.fcFilterUnmemorized = false;
    state.fcIndex = 0;
    state.fcFlipped = false;
    renderFlashcardsView();
    updateNavigationChrome();
  });

  document.getElementById('fc-filter-review').addEventListener('click', () => {
    state.fcFilterUnmemorized = true;
    state.fcIndex = 0;
    state.fcFlipped = false;
    renderFlashcardsView();
    updateNavigationChrome();
  });

  document.getElementById('fc-shuffle-btn').addEventListener('click', () => {
    const ids = ch.flashcards.map((c) => c.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    state.fcCustomOrder = ids;
    state.fcIndex = 0;
    state.fcFlipped = false;
    renderFlashcardsView();
    updateNavigationChrome();
  });

  if (!currentCard) {
    const resetFilterBtn = document.getElementById('fc-reset-filter');
    if (resetFilterBtn) {
      resetFilterBtn.addEventListener('click', () => {
        state.fcFilterUnmemorized = false;
        state.fcIndex = 0;
        renderFlashcardsView();
      });
    }
    return;
  }

  const cardInner = document.getElementById('fc-card-inner');
  gsap.set(cardInner, { rotateY: state.fcFlipped ? 180 : 0 });

  const flipCard = () => {
    state.fcFlipped = !state.fcFlipped;
    gsap.to(cardInner, {
      rotateY: state.fcFlipped ? 180 : 0,
      duration: 0.48,
      ease: 'power2.inOut'
    });
  };

  cardInner.addEventListener('click', (e) => {
    if (e.target.closest('#fc-quote-trigger')) return;
    flipCard();
  });

  cardInner.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      flipCard();
    }
  });

  const quoteBtn = document.getElementById('fc-quote-trigger');
  if (quoteBtn) {
    quoteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const matchingSection =
        ch.problems.find((pr) => pr.pageNumber === currentCard.pageNumber) ||
        ch.intro.find((sec) => sec.pageNumber === currentCard.pageNumber);
      openQuoteModal({
        title: matchingSection ? matchingSection.title : `مقتطف صفحة ${toArabicNum(currentCard.pageNumber)}`,
        pageNumber: currentCard.pageNumber,
        quoteText: matchingSection ? matchingSection.pdfQuote : currentCard.back
      });
    });
  }

  document.getElementById('fc-toggle-mem').addEventListener('click', () => {
    state.memorized[currentCard.id] = !state.memorized[currentCard.id];
    saveJson(STORAGE_KEYS.memorized, state.memorized);
    renderFlashcardsView();
    updateNavigationChrome();
  });

  document.getElementById('fc-prev-btn').addEventListener('click', () => {
    if (state.fcIndex > 0) {
      state.fcIndex -= 1;
      state.fcFlipped = false;
      renderFlashcardsView();
      updateNavigationChrome();
    }
  });

  document.getElementById('fc-next-btn').addEventListener('click', () => {
    if (state.fcIndex < cards.length - 1) {
      state.fcIndex += 1;
      state.fcFlipped = false;
      renderFlashcardsView();
      updateNavigationChrome();
    }
  });
}

// ============================================================================
// ٥. وضع الاختبار الذكي (Quiz Mode)
// ============================================================================

function renderQuizView() {
  const root = document.getElementById('quiz-view-root');
  const ch = getChapter();
  const questions = ch.quizzes;
  const total = questions.length;

  const headerHtml = `
    <div class="study-mode-header">
      <div>
        <div class="meta-line">الاختبار الذكي · الدرس ${ch.arabicNumber}: ${escapeHtml(ch.shortTitle)}</div>
        <h2 class="study-mode-title">تقويم الفهم الفقهي المقارن (${toArabicNum(total)} سؤالاً)</h2>
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <button type="button" class="back-link-btn" id="qz-back-chapter">→ العودة إلى الدرس</button>
        <button type="button" class="btn-outline" id="qz-goto-fc">بطاقات الاستذكار</button>
      </div>
    </div>
  `;

  if (state.quizCompleted) {
    const correctCount = questions.reduce(
      (acc, q, idx) => acc + (state.quizAnswers[idx] === q.correctIndex ? 1 : 0),
      0
    );
    const pct = Math.round((correctCount / total) * 100);
    const prevBest = state.quizScores[ch.id] ?? 0;
    if (pct >= prevBest) {
      state.quizScores[ch.id] = pct;
      saveJson(STORAGE_KEYS.quizScores, state.quizScores);
    }

    const masteryText =
      pct >= 85
        ? 'إتقان متميز لمسائل الدرس وأدلته!'
        : pct >= 65
        ? 'مستوى جيد جداً، راجع المسائل التي أخطأت فيها لتثبيتها.'
        : 'بداية طيبة، ننصح بمراجعة بطاقات الاستذكار والمقتطفات ثم إعادة المحاولة.';

    root.innerHTML = `
      ${headerHtml}
      <div class="quiz-card-shell">
        <div class="quiz-result-summary">
          <div class="quiz-score-circle">
            <strong>${toArabicNum(pct)}%</strong>
            <span style="font-size:0.78rem;">${toArabicNum(correctCount)} / ${toArabicNum(total)}</span>
          </div>
          <h3 class="wf-card-heading">النتيجة النهائية لاختبار الدرس ${ch.arabicNumber}</h3>
          <p class="intro-card-summary">${masteryText}</p>
          <div style="display:flex; justify-content:center; gap:12px; flex-wrap:wrap; margin-top:16px;">
            <button type="button" class="btn-dark" id="qz-retry-btn">إعادة الاختبار</button>
            <button type="button" class="btn-outline" id="qz-finish-back">العودة إلى لوحة الدرس</button>
          </div>
        </div>

        <div class="quiz-review-list">
          ${questions
            .map((q, idx) => {
              const chosen = state.quizAnswers[idx];
              const isOk = chosen === q.correctIndex;
              return `
              <div class="quiz-review-item">
                <div style="display:flex; justify-content:space-between; gap:10px; font-weight:800; margin-bottom:4px;">
                  <span>${toArabicNum(idx + 1)}. ${escapeHtml(q.question)}</span>
                  <span style="color:${isOk ? 'var(--emerald-text)' : 'var(--crimson-text)'}; flex-shrink:0;">
                    ${isOk ? '✓ صحيحة' : '✕ خاطئة'}
                  </span>
                </div>
                <div style="color:var(--emerald-text); font-weight:700;">الإجابة الصحيحة: ${escapeHtml(q.options[q.correctIndex])}</div>
                <div style="color:var(--text-secondary); margin-top:4px;">${escapeHtml(q.explanation)} (ص ${toArabicNum(q.pageNumber)})</div>
              </div>
            `;
            })
            .join('')}
        </div>
      </div>
    `;

    document.getElementById('qz-back-chapter').addEventListener('click', () => navigateTo('chapter'));
    document.getElementById('qz-goto-fc').addEventListener('click', () => openFlashcards(ch.id));
    document.getElementById('qz-finish-back').addEventListener('click', () => navigateTo('chapter'));
    document.getElementById('qz-retry-btn').addEventListener('click', () => {
      state.quizIndex = 0;
      state.quizAnswers = {};
      state.quizCompleted = false;
      renderQuizView();
      updateNavigationChrome();
    });
    return;
  }

  const q = questions[state.quizIndex];
  const selected = state.quizAnswers[state.quizIndex];
  const hasAnswered = selected !== undefined;
  const isRight = selected === q.correctIndex;
  const currentScore = questions.reduce(
    (acc, item, i) => acc + (state.quizAnswers[i] === item.correctIndex ? 1 : 0),
    0
  );

  root.innerHTML = `
    ${headerHtml}
    <div class="quiz-card-shell">
      <div class="quiz-progress-row">
        <span>السؤال ${toArabicNum(state.quizIndex + 1)} من ${toArabicNum(total)}</span>
        <span>الإجابات الصحيحة: ${toArabicNum(currentScore)}</span>
      </div>
      <div class="quiz-progress-track">
        <div class="quiz-progress-fill" style="width:${((state.quizIndex + 1) / total) * 100}%"></div>
      </div>

      <h3 class="quiz-question-text">${escapeHtml(q.question)}</h3>

      <div class="quiz-options-list">
        ${q.options
          .map((opt, idx) => {
            let cls = 'quiz-option-btn';
            if (hasAnswered) {
              if (idx === q.correctIndex) cls += ' is-correct';
              else if (idx === selected) cls += ' is-wrong';
            }
            return `
            <button type="button" class="${cls}" data-quiz-opt="${idx}" ${hasAnswered ? 'disabled' : ''}>
              <span class="quiz-option-letter">${ARABIC_LETTERS[idx]}</span>
              <span>${escapeHtml(opt)}</span>
            </button>
          `;
          })
          .join('')}
      </div>

      ${
        hasAnswered
          ? `
        <div class="quiz-feedback-box ${isRight ? 'is-correct' : 'is-wrong'}" id="qz-feedback-box">
          <div class="quiz-feedback-head">
            <span>${isRight ? '✓ أحسنت! إجابة صحيحة' : '✕ إجابة غير صحيحة'}</span>
            <button type="button" class="quote-btn" id="qz-quote-btn">عرض مقتطف ص ${toArabicNum(q.pageNumber)}</button>
          </div>
          <p class="wf-card-body">${escapeHtml(q.explanation)} — المرجع: ص ${toArabicNum(q.pageNumber)}</p>
        </div>
        <div class="wf-footer-bar">
          <span class="wf-source-note">مرجع السؤال: صفحة ${toArabicNum(q.pageNumber)} من المقرر</span>
          <button type="button" class="btn-dark" id="qz-next-btn">
            ${state.quizIndex < total - 1 ? 'السؤال التالي ←' : 'عرض النتيجة النهائية ←'}
          </button>
        </div>
      `
          : ''
      }
    </div>
  `;

  document.getElementById('qz-back-chapter').addEventListener('click', () => navigateTo('chapter'));
  document.getElementById('qz-goto-fc').addEventListener('click', () => openFlashcards(ch.id));

  root.querySelectorAll('[data-quiz-opt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const optIdx = Number(btn.getAttribute('data-quiz-opt'));
      state.quizAnswers[state.quizIndex] = optIdx;
      renderQuizView();
      const fb = document.getElementById('qz-feedback-box');
      if (fb) {
        gsap.fromTo(fb, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.25, ease: 'power2.out' });
      }
    });
  });

  const qQuoteBtn = document.getElementById('qz-quote-btn');
  if (qQuoteBtn) {
    qQuoteBtn.addEventListener('click', () => {
      const match =
        ch.problems.find((pr) => pr.pageNumber === q.pageNumber) ||
        ch.intro.find((sec) => sec.pageNumber === q.pageNumber);
      openQuoteModal({
        title: match ? match.title : `توثيق المقرر ص ${toArabicNum(q.pageNumber)}`,
        pageNumber: q.pageNumber,
        quoteText: match ? match.pdfQuote : q.explanation
      });
    });
  }

  const nextBtn = document.getElementById('qz-next-btn');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (state.quizIndex < total - 1) {
        state.quizIndex += 1;
      } else {
        state.quizCompleted = true;
      }
      renderQuizView();
      updateNavigationChrome();
    });
  }
}

// ============================================================================
// ٦. وضع عرض الشرائح التفاعلي للباب (مطابق للصور المرجعية)
// ============================================================================

function buildChapterSlides(ch) {
  const slides = [];

  // الشريحة الافتتاحية للدرس
  slides.push({
    type: 'overview',
    meta: `الدرس ${ch.arabicNumber} · الصفحات: ص ${toArabicNum(ch.pageStart)} – ص ${toArabicNum(ch.pageEnd)}`,
    title: ch.title,
    goal: ch.summaryGoal,
    pageNumber: ch.pageStart,
    items: ch.objectives,
    quoteTitle: `مقدمة الدرس ${ch.arabicNumber}`,
    quoteText: ch.intro[0]?.pdfQuote || ch.summaryGoal
  });

  // شرائح التأصيل والمقدمة
  ch.intro.forEach((sec) => {
    slides.push({
      type: 'intro',
      meta: `الدرس ${ch.arabicNumber} · التأصيل النظري · ص ${toArabicNum(sec.pageNumber)}`,
      title: sec.title,
      goal: sec.summary,
      pageNumber: sec.pageNumber,
      items: sec.points,
      quoteTitle: sec.title,
      quoteText: sec.pdfQuote
    });
  });

  // شرائح المسائل الخلافية
  ch.problems.forEach((p) => {
    slides.push({
      type: 'problem',
      problemId: p.id,
      meta: `الدرس ${ch.arabicNumber} · مسألة (${toArabicNum(p.number)}) · ص ${toArabicNum(p.pageNumber)}`,
      title: p.title,
      goal: p.tahrir.question,
      pageNumber: p.pageNumber,
      items: [
        `موضع الاتفاق: ${p.tahrir.agreement}`,
        `محل النزاع: ${p.tahrir.disputePoint}`,
        ...p.opinions.map((o) => `${o.label}: ${o.ruling} (${o.scholars})`),
        `الراجح: ${p.rajih.chosen}`
      ],
      quoteTitle: `مسألة (${toArabicNum(p.number)}): ${p.title}`,
      quoteText: p.pdfQuote
    });
  });

  return slides;
}

function renderSlideDeckView() {
  const root = document.getElementById('slides-view-root');
  const ch = getChapter();
  const slides = buildChapterSlides(ch);
  if (state.slideDeckIndex >= slides.length) state.slideDeckIndex = slides.length - 1;
  if (state.slideDeckIndex < 0) state.slideDeckIndex = 0;

  const current = slides[state.slideDeckIndex];

  root.innerHTML = `
    <div class="slide-deck-shell">
      <div class="slide-deck-card" id="slide-deck-card">
        <div>
          <div class="slide-deck-top">
            <div>
              <div class="slide-deck-meta">${escapeHtml(current.meta)}</div>
              <h2 class="slide-deck-title">${escapeHtml(current.title)}</h2>
            </div>
            <button type="button" class="btn-emerald" id="slide-open-study">
              <span>${current.problemId ? 'فتح المسألة في لوحة المذاكرة ←' : 'فتح لوحة الباب ←'}</span>
            </button>
          </div>

          <div class="slide-deck-goal">
            <strong>الخلاصة المركزة:</strong>
            <span>${escapeHtml(current.goal)}</span>
          </div>

          <div class="slide-deck-body">
            <div class="intro-card" style="box-shadow:none;">
              <div class="intro-card-head">
                <h3 class="intro-card-title">النقاط الجوهرية (انقر زر المقتطف لعرض نص المقرر)</h3>
                <button type="button" class="quote-btn" id="slide-quote-btn">
                  <span>عرض مقتطف ص ${toArabicNum(current.pageNumber)}</span>
                </button>
              </div>
              <ul class="intro-points-list">
                ${current.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div class="slide-controls-footer">
        <button type="button" class="slide-nav-btn" id="slide-prev-btn" ${state.slideDeckIndex === 0 ? 'disabled' : ''}>
          <span>‹ الشريحة السابقة (السهم الأيمن)</span>
        </button>

        <span class="slide-kbd-hint">استخدم مفاتيح الأسهم أو مسافة للتنقل · الشريحة ${toArabicNum(state.slideDeckIndex + 1)} من ${toArabicNum(slides.length)}</span>

        <button type="button" class="slide-nav-btn is-next" id="slide-next-btn" ${state.slideDeckIndex >= slides.length - 1 ? 'disabled' : ''}>
          <span>الشريحة التالية (السهم الأيسر) ›</span>
        </button>
      </div>
    </div>
  `;

  document.getElementById('slide-open-study').addEventListener('click', () => {
    if (current.problemId) {
      openProblem(current.problemId, 1);
    } else {
      navigateTo('chapter');
    }
  });

  document.getElementById('slide-quote-btn').addEventListener('click', () => {
    openQuoteModal({
      title: current.quoteTitle,
      pageNumber: current.pageNumber,
      quoteText: current.quoteText
    });
  });

  document.getElementById('slide-prev-btn').addEventListener('click', () => stepSlideDeck(-1));
  document.getElementById('slide-next-btn').addEventListener('click', () => stepSlideDeck(1));
}

function stepSlideDeck(delta) {
  const ch = getChapter();
  const slides = buildChapterSlides(ch);
  const nextIdx = state.slideDeckIndex + delta;
  if (nextIdx < 0 || nextIdx >= slides.length) return;
  state.slideDeckIndex = nextIdx;
  renderSlideDeckView();
  updateNavigationChrome();

  const card = document.getElementById('slide-deck-card');
  if (card) {
    gsap.fromTo(card, { opacity: 0, x: delta > 0 ? -18 : 18 }, { opacity: 1, x: 0, duration: 0.28, ease: 'power2.out' });
  }
}

// ============================================================================
// التهيئة العامة وربط الأحداث
// ============================================================================

function bindGlobalEvents() {
  document.getElementById('brand-home-btn').addEventListener('click', () => navigateTo('map'));
  document.getElementById('theme-toggle-btn').addEventListener('click', toggleTheme);
  document.getElementById('toc-drawer-btn').addEventListener('click', openTocDrawer);
  document.getElementById('subbar-toc-btn').addEventListener('click', openTocDrawer);
  document.getElementById('study-board-btn').addEventListener('click', () => navigateTo('chapter'));

  document.getElementById('nav-map').addEventListener('click', () => navigateTo('map'));
  document.getElementById('nav-chapter').addEventListener('click', () => navigateTo('chapter'));
  document.getElementById('nav-flashcards').addEventListener('click', () => openFlashcards(state.currentChapterId));
  document.getElementById('nav-quiz').addEventListener('click', () => openQuiz(state.currentChapterId));
  document.getElementById('nav-slides').addEventListener('click', () => openSlideDeck(state.currentChapterId));

  // إغلاق النوافذ المنبثقة
  document.getElementById('quote-modal-close').addEventListener('click', closeQuoteModal);
  document.getElementById('quote-modal-ok').addEventListener('click', closeQuoteModal);
  document.getElementById('quote-modal').addEventListener('click', (e) => {
    if (e.target.id === 'quote-modal') closeQuoteModal();
  });

  document.getElementById('upcoming-modal-close').addEventListener('click', closeUpcomingModal);
  document.getElementById('upcoming-modal-ok').addEventListener('click', closeUpcomingModal);
  document.getElementById('upcoming-goto-ch1').addEventListener('click', () => {
    closeUpcomingModal();
    openChapter(1);
  });
  document.getElementById('upcoming-modal').addEventListener('click', (e) => {
    if (e.target.id === 'upcoming-modal') closeUpcomingModal();
  });

  document.getElementById('toc-drawer-close').addEventListener('click', closeTocDrawer);
  document.getElementById('toc-drawer').addEventListener('click', (e) => {
    if (e.target.id === 'toc-drawer') closeTocDrawer();
  });

  // اختصارات لوحة المفاتيح
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeQuoteModal();
      closeUpcomingModal();
      closeTocDrawer();
      return;
    }

    if (!document.getElementById('quote-modal').hidden || !document.getElementById('upcoming-modal').hidden) {
      return;
    }

    if (state.currentView === 'slides') {
      if (e.key === 'ArrowLeft' || e.key === ' ') {
        e.preventDefault();
        stepSlideDeck(1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepSlideDeck(-1);
      }
    } else if (state.currentView === 'flashcards') {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === ' ') {
        e.preventDefault();
        const cardInner = document.getElementById('fc-card-inner');
        if (cardInner) cardInner.click();
      } else if (e.key === 'ArrowLeft') {
        const nextBtn = document.getElementById('fc-next-btn');
        if (nextBtn && !nextBtn.disabled) nextBtn.click();
      } else if (e.key === 'ArrowRight') {
        const prevBtn = document.getElementById('fc-prev-btn');
        if (prevBtn && !prevBtn.disabled) prevBtn.click();
      }
    }
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.currentView === 'map') {
        drawWindingSvgPath();
      }
    }, 150);
  });
}

async function bootstrap() {
  initTheme();
  bindGlobalEvents();

  revealDeck = new Reveal(document.getElementById('main-reveal'), {
    embedded: true,
    disableLayout: true,
    rtl: true,
    transition: 'fade',
    transitionSpeed: 'default',
    controls: false,
    progress: false,
    keyboard: false,
    touch: false,
    hash: false,
    help: false
  });

  await revealDeck.initialize();
  renderMapView();
  updateNavigationChrome();
}

document.addEventListener('DOMContentLoaded', bootstrap);
