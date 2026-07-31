import type { HumanContactState, HumanSafetyCaseState, SafetyFusionGuardDisposition, SafetyFusionReasonCode } from '@ros/contracts';
import { deadlineRemainingSeconds, deadlineState, type HumanSafetyCommandCenterState, type HumanSafetyCommandCenterController } from './human-safety-command-center.js';
import type { CommandCenterCaseView } from './human-safety-gateway.js';

const CASE_STATE_AR: Readonly<Record<HumanSafetyCaseState, string>> = {
  UNKNOWN: 'غير معروفة', CONTACT_PENDING: 'بانتظار التواصل', CONTACTING: 'جارٍ التواصل', RESPONDED: 'تم الرد',
  NO_RESPONSE: 'لا توجد استجابة', UNREACHABLE: 'تعذر الوصول', HUMAN_REVIEW: 'مراجعة بشرية', ESCALATED: 'مصعّدة',
  TRANSFERRED: 'محالة', MONITORED: 'تحت المراقبة', RESOLVED: 'محلولة'
};
const CONTACT_STATE_AR: Readonly<Record<HumanContactState, string>> = {
  CREATED: 'أُنشئت', CONSENT_PENDING: 'بانتظار الموافقة', LANGUAGE_SELECTION: 'اختيار اللغة', CONTACTING: 'جارٍ التواصل',
  AWAITING_RESPONSE: 'بانتظار الرد', PARTIAL_RESPONSE: 'رد جزئي', RESPONSE_CONFIRMED: 'رد مؤكد', DISCONNECTED: 'انقطع الاتصال',
  NO_RESPONSE: 'لا توجد استجابة', UNREACHABLE: 'تعذر الوصول', OPERATOR_TAKEOVER: 'استحواذ المشغل', HUMAN_REVIEW: 'مراجعة بشرية',
  ESCALATED: 'مصعّدة', COMPLETED: 'مكتملة'
};
const REASON_AR: Readonly<Partial<Record<SafetyFusionReasonCode, string>>> = {
  FUSION_HIGH_RISK_INDICATOR: 'مؤشر سلامة عالي الخطورة', FUSION_DEVICE_IMPACT: 'اكتشاف اصطدام من الجهاز',
  FUSION_DEVICE_AIRBAG: 'إشارة وسادة هوائية', FUSION_DEVICE_ROLLOVER: 'إشارة انقلاب', FUSION_HELP_REQUESTED: 'طلب مساعدة مسجل',
  FUSION_NO_RESPONSE: 'عدم استجابة الشخص', FUSION_CHANNEL_UNAVAILABLE: 'قناة التواصل غير متاحة', FUSION_CORROBORATED: 'الإشارات متساندة',
  FUSION_CONTRADICTORY_INPUTS: 'مدخلات متعارضة', FUSION_SPARSE_EVIDENCE: 'الأدلة غير كافية', FUSION_STALE_EVIDENCE: 'الأدلة متأخرة',
  FUSION_DEGRADED_DEVICE: 'حالة الجهاز متدهورة', FUSION_UNVERIFIED_SOURCE: 'مصدر غير موثّق', FUSION_GUARD_DEGRADED: 'إحدى بوابات الحماية متدهورة',
  FUSION_GUARD_BLOCKED: 'بوابة حماية منعت القرار', FUSION_AUTONOMOUS_DOWNGRADE_BLOCKED: 'منع خفض الخطورة آليًا',
  FUSION_HIGH_UNCERTAINTY: 'عدم يقين مرتفع', FUSION_HUMAN_AUTHORITY_REQUIRED: 'يلزم قرار بشري'
};
const GUARD_AR: Readonly<Record<SafetyFusionGuardDisposition, string>> = { CLEAR: 'سليم', DEGRADED: 'متدهور', BLOCK_AND_REVIEW: 'منع ومراجعة' };

export function renderHumanSafetyCommandCenter(state: HumanSafetyCommandCenterState, controller: Pick<HumanSafetyCommandCenterController, 'visibleItems' | 'metrics' | 'canTakeover' | 'canEscalate' | 'canReassign' | 'canAuthorizeResolution'>, now: Date): string {
  const metrics = controller.metrics();
  const simulation = state.simulation ? '<div class="alert simulation" role="status"><strong>بيئة محاكاة فقط:</strong> لا يوجد اتصال حقيقي بالإسعاف أو الجهات الحكومية، ولا تصدر الواجهة تشخيصًا أو ضمان استجابة.</div>' : '';
  const stale = state.stale ? '<div class="alert warning" role="alert">البيانات قديمة. تم تعطيل الإجراءات الحرجة حتى التحديث.</div>' : '';
  const error = state.error === null ? '' : `<div class="alert error" role="alert">${escape(state.error)}</div>`;
  return `<main id="main-content" tabindex="-1">
    <header class="topbar command-center-header"><div><p class="eyebrow">ROS Eye — مركز قيادة سلامة الإنسان</p><h1>الإنسان أولًا، والقرار الحرج تحت سلطة بشرية</h1><p class="muted">عرض تشغيلي محدود الصلاحيات؛ لا يعرض محادثات خامًا أو موقعًا دقيقًا أو بيانات طبية.</p></div><button id="refresh-button" type="button">تحديث آمن</button></header>
    ${simulation}${stale}${error}
    <section class="metric-grid" aria-label="مؤشرات الحالات الحرجة">${metricCard('إجمالي الحالات', metrics.total, '')}${metricCard('متجاوزة للمهلة', metrics.overdue, metrics.overdue > 0 ? 'danger' : '')}${metricCard('تقترب من المهلة', metrics.imminent, metrics.imminent > 0 ? 'warning-card' : '')}${metricCard('حرجة S4', metrics.severityFour, metrics.severityFour > 0 ? 'danger' : '')}${metricCard('غير مسندة', metrics.unassigned, metrics.unassigned > 0 ? 'warning-card' : '')}</section>
    <div class="command-layout"><section class="panel queue" aria-labelledby="human-queue-title"><div class="section-title"><div><h2 id="human-queue-title">طابور السلامة</h2><small>الحالات العاجلة تبقى ظاهرة مهما كان المرشح.</small></div><label class="compact-control">المرشح<select id="case-filter">${filterOption('ALL', 'الكل', state.filter)}${filterOption('URGENT', 'العاجلة', state.filter)}${filterOption('UNASSIGNED', 'غير المسندة', state.filter)}${filterOption('MY_CASES', 'حالاتي', state.filter)}</select></label></div>${queueContent(state, controller.visibleItems(), now)}</section>
    ${renderCaseDetail(state.selected, controller, now)}</div>
  </main>`;
}

function queueContent(state: HumanSafetyCommandCenterState, items: readonly CommandCenterCaseView[], now: Date): string {
  if (state.phase === 'loading') return '<p role="status">جارٍ تحميل حالات سلامة الإنسان…</p>';
  if (state.phase === 'empty') return '<p class="muted">لا توجد حالات سلامة نشطة.</p>';
  if (items.length === 0) return '<p class="muted">لا توجد حالات مطابقة، مع استمرار تثبيت الحالات العاجلة تلقائيًا.</p>';
  return items.map((item) => queueRow(item, now, state.selected?.safetyCase.id ?? null)).join('');
}

function queueRow(item: CommandCenterCaseView, now: Date, selectedId: string | null): string {
  const deadline = deadlineState(item, now);
  const selected = selectedId === item.safetyCase.id ? ' aria-current="true"' : '';
  const urgent = deadline === 'OVERDUE' || deadline === 'IMMINENT' || item.safetyCase.severity === 'S4';
  return `<button class="human-case-row severity-${item.safetyCase.severity} deadline-${deadline}" data-case-id="${escape(item.safetyCase.id)}"${selected}>
    <span class="case-title"><strong>${escape(item.safetyCase.id)}</strong><small>${escape(CASE_STATE_AR[item.safetyCase.state])} · ${escape(item.safetyCase.assignedActorId ?? 'غير مسندة')}</small></span>
    <span class="badge">${escape(item.safetyCase.severity)}</span><span class="deadline-label"${urgent ? ' aria-label="حالة عاجلة"' : ''}>${escape(formatDeadline(item, now))}</span>
    <span><small>التواصل</small>${escape(item.contactSession === null ? 'غير مبدوء' : CONTACT_STATE_AR[item.contactSession.state])}</span>
    <span><small>عدم اليقين</small>${item.recommendation === null ? '—' : `${Math.round(item.recommendation.uncertainty * 100)}٪`}</span>
  </button>`;
}

function renderCaseDetail(item: CommandCenterCaseView | null, controller: Pick<HumanSafetyCommandCenterController, 'canTakeover' | 'canEscalate' | 'canReassign' | 'canAuthorizeResolution'>, now: Date): string {
  if (item === null) return '<section class="panel detail" aria-labelledby="case-detail-title"><h2 id="case-detail-title">تفاصيل حالة الإنسان</h2><p class="muted">اختر حالة من طابور السلامة.</p></section>';
  const safety = item.safetyCase;
  const contact = item.contactSession;
  const disabledTakeover = controller.canTakeover() ? '' : 'disabled';
  const disabledEscalate = controller.canEscalate() ? '' : 'disabled';
  const disabledReassign = controller.canReassign() ? '' : 'disabled';
  const disabledResolution = controller.canAuthorizeResolution() ? '' : 'disabled';
  const healthClass = item.dependencyHealth === 'HEALTHY' && item.connectivity === 'HEALTHY' ? 'healthy' : 'warning-card';
  return `<section class="panel detail" aria-labelledby="case-detail-title">
    <div class="detail-heading"><div><h2 id="case-detail-title">${escape(safety.id)}</h2><p>${escape(CASE_STATE_AR[safety.state])} · الإصدار ${safety.version} · ${escape(formatDeadline(item, now))}</p></div><span class="badge severity-${safety.severity}">${escape(safety.severity)}</span></div>
    <div class="detail-grid human-safety-grid">
      <article><h3>التواصل الإنساني</h3><dl class="fact-list"><div><dt>الحالة</dt><dd>${escape(contact === null ? 'غير مبدوء' : CONTACT_STATE_AR[contact.state])}</dd></div><div><dt>القناة</dt><dd>${escape(contact?.activeChannel ?? safety.activeChannel ?? 'لا توجد')}</dd></div><div><dt>المحاولات</dt><dd>${contact?.attemptCount ?? 0}</dd></div><div><dt>المشغل</dt><dd>${escape(contact?.assignedOperatorId ?? safety.assignedActorId ?? 'غير مسندة')}</dd></div></dl></article>
      <article class="${healthClass}"><h3>جاهزية النظام</h3><dl class="fact-list"><div><dt>الاتصال</dt><dd>${escape(item.connectivity)}</dd></div><div><dt>الاعتماديات</dt><dd>${escape(item.dependencyHealth)}</dd></div><div><dt>الأدلة</dt><dd>${escape(item.evidenceState)}</dd></div><div><dt>البيانات</dt><dd>مقنّعة وفق أقل قدر ضروري</dd></div></dl></article>
      <article><h3>المؤشرات المنظمة</h3>${safety.indicators.length === 0 ? '<p class="muted">لا توجد مؤشرات منظمة.</p>' : `<ul class="compact-list">${safety.indicators.map((indicator) => `<li><strong>${escape(indicator.code)}</strong><span>${Math.round(indicator.confidence * 100)}٪ · ${escape(indicator.source)}</span></li>`).join('')}</ul>`}</article>
      <article><h3>مصادر الإشارة</h3>${item.provenance.length === 0 ? '<p class="muted">لا توجد بيانات مصدر معروضة.</p>' : `<ul class="compact-list">${item.provenance.map((entry) => `<li><strong>${escape(entry.sourceType)}</strong><span>${escape(entry.integrity)} · ${escape(entry.status)} · ${escape(new Date(entry.receivedAt).toLocaleTimeString('ar-SA'))}</span></li>`).join('')}</ul>`}</article>
    </div>
    ${renderRecommendation(item)}
    <section class="action-grid" aria-label="إجراءات المشغل والمشرف">
      <form id="takeover-form" class="action-box"><h3>استحواذ المشغل</h3><p>يوقف الأتمتة المتعارضة ويجعل المشغل مسؤولًا عن التواصل.</p>${reasonField('takeover-reason', disabledTakeover)}<button type="submit" class="primary" ${disabledTakeover}>استحواذ بشري</button></form>
      <form id="escalate-form" class="action-box critical"><h3>تصعيد الحالة</h3><p>لا يرسل جهة حقيقية؛ يسجل الحاجة إلى تدخل بشري أعلى.</p>${reasonField('escalate-reason', disabledEscalate)}<button type="submit" ${disabledEscalate}>تصعيد</button></form>
      <form id="reassign-form" class="action-box"><h3>إعادة الإسناد</h3><label>معرّف المشغل الجديد<input name="assigneeId" pattern="[A-Za-z0-9][A-Za-z0-9._:-]{2,127}" required ${disabledReassign}></label>${reasonField('reassign-reason', disabledReassign)}<button type="submit" ${disabledReassign}>إعادة الإسناد</button></form>
      <form id="resolution-form" class="action-box critical"><h3>تفويض الحل عالي الخطورة</h3><p>متاح فقط بعد المراقبة، وثقة الأدلة، وسلامة الاتصال والاعتماديات.</p>${reasonField('resolution-reason', disabledResolution)}<button type="submit" ${disabledResolution}>تفويض الحل</button></form>
    </section>
    <section aria-labelledby="audit-title"><h3 id="audit-title">سجل التدقيق غير القابل للتعديل</h3>${renderAudit(item)}</section>
  </section>`;
}

function renderRecommendation(item: CommandCenterCaseView): string {
  const recommendation = item.recommendation;
  if (recommendation === null) return '<section class="recommendation-panel"><h3>توصية الدمج</h3><p class="muted">لا توجد توصية متاحة؛ يلزم تقييم بشري.</p></section>';
  return `<section class="recommendation-panel" aria-labelledby="recommendation-title"><div class="section-title"><div><h3 id="recommendation-title">توصية سلامة قابلة للتفسير</h3><p>توصية فقط — لا تملك سلطة خفض الخطورة أو الحل أو الإرسال.</p></div><span class="badge severity-${recommendation.recommendedSeverity}">${escape(recommendation.recommendedSeverity)} · ثقة ${Math.round(recommendation.confidence * 100)}٪</span></div>
    <div class="recommendation-grid"><div><strong>عدم اليقين</strong><span>${Math.round(recommendation.uncertainty * 100)}٪</span></div><div><strong>المراجعة البشرية</strong><span>${recommendation.requiresHumanReview ? 'إلزامية' : 'غير مطلوبة'}</span></div><div><strong>السلطة</strong><span>${escape(recommendation.authority)}</span></div><div><strong>البصمة</strong><code>${escape(recommendation.deterministicFingerprint)}</code></div></div>
    <ul class="reason-list">${recommendation.reasonCodes.map((code) => `<li>${escape(REASON_AR[code] ?? code)}</li>`).join('')}</ul><div class="guard-grid">${recommendation.guardResults.map((guard) => `<span class="guard guard-${guard.disposition}">${escape(guard.kind)}: ${escape(GUARD_AR[guard.disposition])}</span>`).join('')}</div></section>`;
}

function renderAudit(item: CommandCenterCaseView): string {
  if (item.audit.length === 0) return '<p class="muted">لا توجد أحداث تدقيق.</p>';
  return `<ol class="timeline">${item.audit.map((entry) => `<li><strong>${escape(entry.action)}</strong><span>${escape(new Date(entry.occurredAt).toLocaleString('ar-SA'))}</span><span>${escape(entry.actorRole)} · ${escape(entry.actorId)} · الإصدار ${entry.caseVersion}</span><span>${escape(entry.reason)}</span><code>${escape(entry.traceId)}</code></li>`).join('')}</ol>`;
}

function metricCard(label: string, value: number, className: string): string { return `<article class="metric-card ${className}"><span>${escape(label)}</span><strong>${value}</strong></article>`; }
function filterOption(value: string, label: string, selected: string): string { return `<option value="${escape(value)}"${selected === value ? ' selected' : ''}>${escape(label)}</option>`; }
function reasonField(name: string, disabled: string): string { return `<label>سبب القرار<textarea name="${escape(name)}" minlength="3" maxlength="500" required ${disabled}></textarea></label>`; }
function formatDeadline(item: CommandCenterCaseView, now: Date): string { const remaining = deadlineRemainingSeconds(item, now); if (remaining === null) return 'لا توجد مهلة نشطة'; if (remaining <= 0) return `متجاوزة بـ${Math.abs(remaining)} ثانية`; if (remaining <= 60) return `متبقي ${remaining} ثانية`; return `متبقي ${Math.ceil(remaining / 60)} دقيقة`; }
function escape(value: unknown): string { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
