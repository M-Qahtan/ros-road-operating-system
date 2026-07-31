import type { HumanContactReplyOption } from '@ros/contracts';
import type { FieldCompanionState, FieldCompanionShareCategory } from './field-companion.js';

const STATUS_AR: Readonly<Record<string, string>> = {
  consent_pending: 'نحتاج موافقتك قبل بدء التحقق المختصر.', consent_granted: 'تم تسجيل الموافقة. اختر اللغة المناسبة.',
  consent_declined_human_review: 'تم احترام قرارك وتحويل الحالة للمراجعة البشرية.', awaiting_structured_response: 'اختر ردًا واحدًا أو أكثر من الخيارات الآمنة.',
  help_requested_human_review: 'تم تسجيل طلب المساعدة وتحويله للمراجعة البشرية.', cannot_speak_human_review: 'تم تسجيل أنك لا تستطيع التحدث؛ سيظهر ذلك للمشغل.',
  reply_queued: 'تم حفظ الرد وسيرسل عند توفر الاتصال.', delivery_accepted: 'تم استلام البيانات المنظمة بنجاح.',
  operator_takeover_requested: 'تم طلب تدخل مشغل بشري.', human_review_requested: 'الحالة الآن تحت مراجعة بشرية.',
  offline_queue_active: 'لا يوجد اتصال. بياناتك المنظمة محفوظة محليًا وسترسل بعد العودة.',
  critical_battery_reduce_activity: 'البطارية حرجة. تم تقليل النشاط غير الضروري.', device_time_untrusted: 'وقت الجهاز غير موثوق؛ مشاركة بيانات الجهاز متوقفة.',
  location_quality_unavailable: 'جودة الموقع غير متاحة، ولن نخمن موقعك.', device_status_updated: 'تم تحديث حالة الجهاز.',
  contact_completed: 'اكتملت جلسة التواصل. لا يعني ذلك تأكيد وصول جهة طوارئ.'
};
const OPTION_AR: Readonly<Record<HumanContactReplyOption, string>> = {
  YES: 'نعم', NO: 'لا', UNKNOWN: 'لا أعرف', HELP_REQUESTED: 'أحتاج مساعدة', CANNOT_SPEAK: 'لا أستطيع التحدث', ACCESSIBILITY_SUPPORT_REQUIRED: 'أحتاج طريقة أسهل للرد'
};
const SHARE_AR: Readonly<Record<FieldCompanionShareCategory, string>> = {
  CONTACT_STATUS: 'حالة التواصل والموافقة', STRUCTURED_REPLY: 'الردود المحددة فقط', DEVICE_CONDITION: 'حالة الشبكة والبطارية',
  MOTION_INDICATOR: 'مؤشر الحركة المصنف', LOCATION_QUALITY_ONLY: 'جودة الموقع دون الإحداثيات'
};

export function renderFieldCompanion(state: FieldCompanionState): string {
  const offline = state.device.network === 'OFFLINE' ? '<div class="alert offline" role="alert">أنت دون اتصال. لن تفقد ردودك؛ ستبقى في قائمة محلية مشفرة بواسطة منصة الجهاز عند اعتماد التطبيق الإنتاجي.</div>' : '';
  const simulation = '<div class="alert simulation" role="status"><strong>محاكاة آمنة:</strong> هذا المرجع لا يتصل حاليًا بالإسعاف أو المرور، ولا يقدم تشخيصًا أو ضمان وصول مساعدة.</div>';
  const clockWarning = Math.abs(state.device.clockSkewMs) > 300_000 ? '<div class="alert warning" role="alert">ساعة الجهاز غير موثوقة؛ أوقفنا مشاركة بيانات الجهاز وطلبنا مراجعة بشرية.</div>' : '';
  const takeover = state.session.operatorTakeoverVisible ? '<div class="operator-banner" role="status"><strong>مشغل بشري يتابع الحالة الآن.</strong><span>قد تستمر الرسائل المنظمة، ولن تتخذ الأتمتة قرارًا متعارضًا.</span></div>' : '';
  return `<main id="main-content" tabindex="-1">
    <header class="hero"><div><p class="eyebrow">ROS Eye — رفيق السلامة الميداني</p><h1>نحن هنا للاطمئنان عليك</h1><p>أسئلة قصيرة وخيارات واضحة. سلامتك أولًا، وقرار الحالات الحرجة يبقى بشريًا.</p></div><div class="connection-pill network-${state.device.network}">${networkLabel(state.device.network)}</div></header>
    ${simulation}${offline}${clockWarning}${takeover}
    <section class="status-card" aria-labelledby="status-title"><div><h2 id="status-title">حالة التواصل</h2><p class="status-message">${escape(statusMessage(state.session.statusMessageCode))}</p></div><div class="status-meta"><span>${escape(state.session.contactState)}</span><span>${state.pending.length} بانتظار الإرسال</span></div></section>
    <div class="mobile-layout"><section class="panel primary-panel" aria-labelledby="interaction-title"><h2 id="interaction-title">التحقق المختصر</h2>${renderInteraction(state)}</section>
    <aside class="side-stack"><section class="panel" aria-labelledby="sharing-title"><h2 id="sharing-title">ما الذي نشاركه؟</h2><p class="muted">لا نعرض إحداثيات دقيقة ولا نسجل نصًا حرًا أو وصفًا طبيًا.</p><ul class="sharing-list">${sharingRows()}</ul><button id="share-device" type="button" ${canShareDevice(state) ? '' : 'disabled'}>مشاركة حالة الجهاز الآمنة</button></section>
    <section class="panel" aria-labelledby="device-title"><h2 id="device-title">محاكي حالة الجهاز</h2><div class="device-grid">${deviceFact('الشبكة', state.device.network)}${deviceFact('البطارية', state.device.battery)}${deviceFact('جودة الموقع', state.device.locationQuality)}${deviceFact('الحركة', state.device.motion)}${deviceFact('انحراف الساعة', `${state.device.clockSkewMs} ms`)}</div>${renderSimulatorControls()}</section></aside></div>
    <section class="privacy-panel" aria-labelledby="privacy-title"><h2 id="privacy-title">حدود الخصوصية والسلامة</h2><ul>${state.privacyNotice.map((notice) => `<li>${escape(notice)}</li>`).join('')}</ul><details><summary>البيانات التشغيلية الآمنة</summary><pre>${escape(JSON.stringify(privacyTelemetry(state), null, 2))}</pre></details></section>
  </main>`;
}

function renderInteraction(state: FieldCompanionState): string {
  if (state.session.phase === 'COMPLETED') return '<div class="completion"><strong>اكتملت جلسة التواصل</strong><p>يمكن إعادة فتح الحالة فقط عبر مسار سلامة معتمد أو تدخل بشري.</p></div>';
  if (state.session.consent === 'NOT_REQUESTED') return `<div class="prompt-card"><p>نحن هنا للاطمئنان على سلامتك. هل تسمح ببدء تحقق مختصر ومشاركة ردود منظمة فقط؟</p><div class="button-grid"><button data-consent="GRANTED" class="primary large-action">أوافق</button><button data-consent="DECLINED" class="large-action">لا أوافق</button></div></div>`;
  if (state.session.consent === 'DECLINED') return '<div class="prompt-card"><p>لن نجمع ردودًا إضافية. تم وضع الحالة للمراجعة البشرية وفق ضوابط النظام.</p></div>';
  if (state.session.activePromptId === 'contact.language') return `<div class="prompt-card"><p>اختر اللغة المناسبة للتواصل.</p><div class="button-grid"><button data-language="ar" class="primary large-action">العربية</button><button data-language="en" class="large-action">English</button></div></div>`;
  if (state.session.allowedReplyOptions.length > 0) return `<form id="reply-form" class="prompt-card"><fieldset><legend>هل تستطيع الرد الآن؟</legend><div class="reply-options">${state.session.allowedReplyOptions.map((option) => `<label class="reply-option"><input type="checkbox" name="reply" value="${escape(option)}"><span>${escape(OPTION_AR[option])}</span></label>`).join('')}</div></fieldset><button type="submit" class="primary large-action">إرسال الرد المنظم</button></form>`;
  return `<div class="prompt-card"><p>${escape(statusMessage(state.session.statusMessageCode))}</p><button id="reconnect" type="button" ${state.device.network === 'OFFLINE' ? 'disabled' : ''}>مزامنة الحالة</button></div>`;
}

function renderSimulatorControls(): string {
  return `<details class="simulator-controls"><summary>أدوات المحاكاة</summary><div class="control-grid">
    <label>الشبكة<select id="network-control"><option>ONLINE</option><option>DEGRADED</option><option>OFFLINE</option></select></label>
    <label>البطارية<select id="battery-control"><option>NORMAL</option><option>LOW</option><option>CRITICAL</option></select></label>
    <label>الحركة<select id="motion-control"><option>STABLE</option><option>HARD_BRAKE</option><option>POSSIBLE_IMPACT</option><option>POSSIBLE_ROLLOVER</option></select></label>
    <label>جودة الموقع<select id="location-control"><option>APPROXIMATE</option><option>PRECISE_AVAILABLE_RESTRICTED</option><option>UNAVAILABLE</option></select></label>
    <label>انحراف الساعة<input id="clock-control" type="number" value="0" step="1000"></label>
    <button id="simulate-restart" type="button">محاكاة إعادة تشغيل التطبيق</button><button id="simulate-takeover" type="button">محاكاة استحواذ المشغل</button>
  </div></details>`;
}

function sharingRows(): string { return (Object.keys(SHARE_AR) as FieldCompanionShareCategory[]).map((category) => `<li><span>${escape(SHARE_AR[category])}</span><strong>أقل قدر ضروري</strong></li>`).join(''); }
function deviceFact(label: string, value: string): string { return `<div><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`; }
function canShareDevice(state: FieldCompanionState): boolean { return state.session.consent === 'GRANTED' && state.device.network !== 'OFFLINE' && Math.abs(state.device.clockSkewMs) <= 300_000; }
function statusMessage(code: string): string { if (code.startsWith('operator_takeover:')) return `يتابع ${code.split(':')[1] ?? 'مشغل السلامة'} الحالة.`; return STATUS_AR[code] ?? code; }
function networkLabel(value: FieldCompanionState['device']['network']): string { return value === 'ONLINE' ? 'متصل' : value === 'DEGRADED' ? 'اتصال ضعيف' : 'دون اتصال'; }
function privacyTelemetry(state: FieldCompanionState): Readonly<Record<string, unknown>> { return { phase: state.session.phase, contactState: state.session.contactState, network: state.device.network, battery: state.device.battery, locationQuality: state.device.locationQuality, motion: state.device.motion, pendingOperationCount: state.pending.length, simulation: true }; }
function escape(value: unknown): string { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
