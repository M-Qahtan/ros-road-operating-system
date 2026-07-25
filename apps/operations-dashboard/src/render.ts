import type { RoadEventResponse, RoadEventStatusContract, SeverityLevelContract } from '@ros/contracts';
import { attachedSignalIds, DashboardState, deriveHumanSafetyStatus, slaAgeMinutes } from './dashboard.js';

const STATUS_AR: Readonly<Record<RoadEventStatusContract, string>> = {
  DETECTED: 'مكتشف', VALIDATING: 'قيد التحقق', CONFIRMED: 'مؤكد', SAFETY_ASSESSMENT: 'تقييم السلامة',
  RESPONSE_COORDINATION: 'تنسيق الاستجابة', ROAD_CLEARANCE: 'إخلاء الطريق', RECOVERY: 'استعادة الطريق', CLOSED: 'مغلق',
  FALSE_POSITIVE: 'بلاغ غير صحيح', DUPLICATE: 'مكرر', UNDER_REVIEW: 'قيد المراجعة', TRANSFERRED_TO_AUTHORITY: 'محال للجهة'
};
const SEVERITY_AR: Readonly<Record<SeverityLevelContract, string>> = { S0: 'معلوماتي', S1: 'منخفض', S2: 'متوسط', S3: 'مرتفع', S4: 'حرج' };

function escape(value: unknown): string {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function eventRow(event: RoadEventResponse, now: Date, selectedId: string | null): string {
  const selected = selectedId === event.id ? ' aria-current="true"' : '';
  return `<button class="event-row severity-${event.severity.level}" data-event-id="${escape(event.id)}"${selected}>
    <span class="event-main"><strong>${escape(STATUS_AR[event.status])}</strong><small>${escape(event.id)}</small></span>
    <span class="badge" aria-label="الخطورة ${escape(SEVERITY_AR[event.severity.level])}">${escape(event.severity.level)} · ${escape(SEVERITY_AR[event.severity.level])}</span>
    <span>${slaAgeMinutes(event, now)} دقيقة</span>
    <span dir="ltr">${event.latitude.toFixed(4)}, ${event.longitude.toFixed(4)}</span>
  </button>`;
}

function timeline(state: DashboardState): string {
  if (state.timeline.length === 0) return '<p class="muted">لا توجد سجلات تدقيق متاحة.</p>';
  return `<ol class="timeline">${state.timeline.map((entry) => `<li>
    <strong>${escape(entry.action)}</strong>
    <span>${escape(new Date(entry.occurredAt).toLocaleString('ar-SA'))}</span>
    <span>${escape(entry.reason ?? 'بدون سبب مسجل')}</span>
    <code>${escape(entry.traceId)}</code>
  </li>`).join('')}</ol>`;
}

function detail(state: DashboardState, canTransition: boolean, canAuthorize: boolean): string {
  const event = state.selected;
  if (event === null) return '<section class="panel detail" aria-labelledby="detail-title"><h2 id="detail-title">تفاصيل الحدث</h2><p class="muted">اختر حدثًا من القائمة.</p></section>';
  const signals = attachedSignalIds(state.timeline);
  return `<section class="panel detail" aria-labelledby="detail-title">
    <div class="detail-heading"><div><h2 id="detail-title">الحدث ${escape(event.id)}</h2><p>${escape(STATUS_AR[event.status])} · الإصدار ${event.version}</p></div>
    <span class="badge severity-${event.severity.level}">${escape(event.severity.level)} · ${escape(SEVERITY_AR[event.severity.level])}</span></div>
    <div class="detail-grid">
      <article><h3>سلامة الإنسان</h3><p>${escape(deriveHumanSafetyStatus(event, state.timeline))}</p><small>الثقة ${(event.severity.confidence * 100).toFixed(0)}٪ — المراجعة البشرية ${event.severity.requiresHumanReview ? 'مطلوبة' : 'غير مطلوبة'}</small></article>
      <article><h3>الإشارات المرتبطة</h3>${signals.length === 0 ? '<p class="muted">لا توجد إشارات معروضة في سجل التدقيق.</p>' : `<ul>${signals.map((id) => `<li><code>${escape(id)}</code></li>`).join('')}</ul>`}</article>
      <article><h3>الموقع</h3><p dir="ltr">${event.latitude.toFixed(6)}, ${event.longitude.toFixed(6)}</p></article>
      <article><h3>تفويض الإغلاق</h3><p>${event.closureAuthorization === null ? 'لا يوجد تفويض' : escape(event.closureAuthorization.reason)}</p></article>
    </div>
    <form id="transition-form" class="action-box" ${canTransition ? '' : 'aria-disabled="true"'}>
      <h3>تغيير الحالة</h3><label>الحالة التالية<select name="nextStatus" ${canTransition ? '' : 'disabled'}>${Object.entries(STATUS_AR).map(([value, label]) => `<option value="${value}">${escape(label)}</option>`).join('')}</select></label>
      <label>سبب القرار<textarea name="reason" minlength="3" maxlength="500" required ${canTransition ? '' : 'disabled'}></textarea></label>
      <button type="submit" class="primary" ${canTransition ? '' : 'disabled'}>مراجعة وتنفيذ الانتقال</button>
    </form>
    <form id="closure-form" class="action-box critical" ${canAuthorize ? '' : 'aria-disabled="true"'}>
      <h3>تفويض إغلاق S3/S4</h3><p>إجراء حرج لا يتوفر إلا للمشرف، ويُسجل في سجل تدقيق غير قابل للتعديل.</p>
      <label>سبب التفويض<textarea name="reason" minlength="3" maxlength="500" required ${canAuthorize ? '' : 'disabled'}></textarea></label>
      <button type="submit" ${canAuthorize ? '' : 'disabled'}>مراجعة وتفويض الإغلاق</button>
    </form>
    <section aria-labelledby="timeline-title"><h3 id="timeline-title">التسلسل الزمني وسجل التدقيق</h3>${timeline(state)}</section>
  </section>`;
}

export function renderDashboard(state: DashboardState, options: { readonly canTransition: boolean; readonly canAuthorizeClosure: boolean; readonly now: Date }): string {
  const banner = state.stale ? '<div class="alert warning" role="status">البيانات قديمة. حدّث الشاشة قبل اتخاذ قرار حرج.</div>' : '';
  const error = state.error === null ? '' : `<div class="alert error" role="alert">${escape(state.error)}</div>`;
  const listContent = state.phase === 'loading' ? '<p role="status">جارٍ تحميل الأحداث…</p>'
    : state.phase === 'empty' ? '<p class="muted">لا توجد أحداث نشطة.</p>'
    : state.events.map((event) => eventRow(event, options.now, state.selected?.id ?? null)).join('');
  return `<main id="main-content" tabindex="-1">
    <header class="topbar"><div><p class="eyebrow">ROS — مركز العمليات</p><h1>إدارة أحداث الطريق</h1></div><button id="refresh-button" type="button">تحديث البيانات</button></header>
    ${banner}${error}
    <div class="layout"><section class="panel queue" aria-labelledby="queue-title"><div class="section-title"><h2 id="queue-title">قائمة الأحداث</h2><span>${state.events.length}</span></div>${listContent}</section>
    ${detail(state, options.canTransition, options.canAuthorizeClosure)}</div>
  </main>`;
}
