import {
  HUMAN_CONTACT_REPLY_MAX_CLOCK_SKEW_MS,
  HUMAN_CONTACT_REPLY_MAX_AGE_MS,
  type HumanContactReplyOption,
  type HumanContactState
} from '@ros/contracts';

export const FIELD_COMPANION_SCHEMA_VERSION = 'ros-eye.field-companion.v1' as const;
export const FIELD_COMPANION_PRIVACY_POLICY_VERSION = 'ros-eye.field-privacy.v1' as const;
export const FIELD_COMPANION_MAX_QUEUE = 100;
export const FIELD_COMPANION_LOCAL_RETENTION_MS = 24 * 60 * 60 * 1000;

export type FieldCompanionConsent = 'NOT_REQUESTED' | 'GRANTED' | 'DECLINED' | 'EMERGENCY_SAFETY_REVIEW';
export type FieldCompanionNetwork = 'ONLINE' | 'DEGRADED' | 'OFFLINE';
export type FieldCompanionBattery = 'NORMAL' | 'LOW' | 'CRITICAL';
export type FieldCompanionLocationQuality = 'PRECISE_AVAILABLE_RESTRICTED' | 'APPROXIMATE' | 'UNAVAILABLE';
export type FieldCompanionMotion = 'STABLE' | 'HARD_BRAKE' | 'POSSIBLE_IMPACT' | 'POSSIBLE_ROLLOVER';
export type FieldCompanionPhase = 'BOOTING' | 'READY' | 'OFFLINE' | 'HUMAN_REVIEW' | 'OPERATOR_TAKEOVER' | 'COMPLETED' | 'FAILURE';
export type FieldCompanionShareCategory = 'CONTACT_STATUS' | 'STRUCTURED_REPLY' | 'DEVICE_CONDITION' | 'MOTION_INDICATOR' | 'LOCATION_QUALITY_ONLY';
export type FieldCompanionOperationKind = 'STRUCTURED_REPLY' | 'DEVICE_METADATA' | 'RECONNECT';

export interface FieldCompanionDeviceSnapshot {
  readonly network: FieldCompanionNetwork;
  readonly battery: FieldCompanionBattery;
  readonly locationQuality: FieldCompanionLocationQuality;
  readonly motion: FieldCompanionMotion;
  readonly clockSkewMs: number;
  readonly observedAt: string;
  readonly appInstanceId: string;
}

export interface FieldCompanionSession {
  readonly tenantId: string;
  readonly caseId: string;
  readonly sessionId: string;
  readonly language: 'ar' | 'en';
  readonly contactState: HumanContactState;
  readonly phase: FieldCompanionPhase;
  readonly consent: FieldCompanionConsent;
  readonly activePromptId: string | null;
  readonly allowedReplyOptions: readonly HumanContactReplyOption[];
  readonly operatorTakeoverVisible: boolean;
  readonly simulation: true;
  readonly statusMessageCode: string;
  readonly lastServerReceiptAt: string | null;
}

export interface FieldCompanionStructuredReply {
  readonly promptId: string;
  readonly promptVersion: number;
  readonly selectedOptions: readonly HumanContactReplyOption[];
  readonly occurredAt: string;
}

export interface FieldCompanionDeviceMetadata {
  readonly network: FieldCompanionNetwork;
  readonly battery: FieldCompanionBattery;
  readonly locationQuality: FieldCompanionLocationQuality;
  readonly motion: FieldCompanionMotion;
  readonly clockSkewBucket: 'WITHIN_POLICY' | 'OUTSIDE_POLICY';
  readonly observedAt: string;
  readonly sharedCategories: readonly FieldCompanionShareCategory[];
}

export interface FieldCompanionQueuedOperation {
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly kind: FieldCompanionOperationKind;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly attemptCount: number;
  readonly payload: FieldCompanionStructuredReply | FieldCompanionDeviceMetadata | Readonly<Record<string, never>>;
}

export interface FieldCompanionPersistedState {
  readonly schemaVersion: typeof FIELD_COMPANION_SCHEMA_VERSION;
  readonly privacyPolicyVersion: typeof FIELD_COMPANION_PRIVACY_POLICY_VERSION;
  readonly savedAt: string;
  readonly session: FieldCompanionSession;
  readonly device: FieldCompanionDeviceSnapshot;
  readonly pending: readonly FieldCompanionQueuedOperation[];
  readonly acknowledgedIdempotencyKeys: readonly string[];
}

export interface FieldCompanionState extends FieldCompanionPersistedState {
  readonly error: string | null;
  readonly privacyNotice: readonly string[];
}

export interface FieldCompanionDeliveryReceipt {
  readonly idempotencyKey: string;
  readonly disposition: 'ACCEPTED' | 'DUPLICATE' | 'HUMAN_REVIEW' | 'OPERATOR_TAKEOVER';
  readonly contactState: HumanContactState;
  readonly statusMessageCode: string;
  readonly receivedAt: string;
}

export interface FieldCompanionGateway {
  deliver(input: {
    readonly tenantId: string;
    readonly caseId: string;
    readonly sessionId: string;
    readonly operation: FieldCompanionQueuedOperation;
  }): Promise<FieldCompanionDeliveryReceipt>;
}

export interface FieldCompanionStorage {
  load(storageKey: string): Promise<FieldCompanionPersistedState | null>;
  save(storageKey: string, state: FieldCompanionPersistedState): Promise<void>;
  clear(storageKey: string): Promise<void>;
}

export interface FieldCompanionIdFactory { create(prefix: string): string }

export interface FieldCompanionBootstrap {
  readonly tenantId: string;
  readonly caseId: string;
  readonly sessionId: string;
  readonly language: 'ar' | 'en';
  readonly appInstanceId: string;
  readonly now: string;
}

export class FieldSafetyCompanionController {
  private current: FieldCompanionState;

  constructor(
    private readonly storage: FieldCompanionStorage,
    private readonly gateway: FieldCompanionGateway,
    private readonly ids: FieldCompanionIdFactory,
    private readonly storageKey: string,
    private readonly now: () => Date = () => new Date()
  ) {
    this.current = failureState('companion_not_booted');
  }

  get state(): FieldCompanionState { return this.current; }

  async boot(input: FieldCompanionBootstrap): Promise<FieldCompanionState> {
    validateBootstrap(input);
    const persisted = await this.storage.load(this.storageKey);
    if (persisted !== null && validPersisted(persisted, input, this.now())) {
      this.current = { ...persisted, session: { ...persisted.session, phase: phaseForNetwork(persisted.device.network, persisted.session.phase) }, error: null, privacyNotice: privacyNotice() };
    } else {
      this.current = initialState(input);
      await this.persist();
    }
    if (this.current.device.network !== 'OFFLINE') await this.flush();
    return this.current;
  }

  async setConsent(consent: Extract<FieldCompanionConsent, 'GRANTED' | 'DECLINED'>): Promise<FieldCompanionState> {
    this.requireBooted();
    const contactState: HumanContactState = consent === 'GRANTED' ? 'LANGUAGE_SELECTION' : 'HUMAN_REVIEW';
    this.current = {
      ...this.current,
      session: {
        ...this.current.session,
        consent,
        contactState,
        phase: consent === 'GRANTED' ? phaseForNetwork(this.current.device.network, 'READY') : 'HUMAN_REVIEW',
        activePromptId: consent === 'GRANTED' ? 'contact.language' : null,
        allowedReplyOptions: consent === 'GRANTED' ? ['YES', 'NO'] : [],
        statusMessageCode: consent === 'GRANTED' ? 'consent_granted' : 'consent_declined_human_review'
      }
    };
    await this.persist();
    return this.current;
  }

  async selectLanguage(language: 'ar' | 'en'): Promise<FieldCompanionState> {
    this.requireConsent();
    this.current = {
      ...this.current,
      session: {
        ...this.current.session,
        language,
        contactState: 'AWAITING_RESPONSE',
        activePromptId: 'contact.response',
        allowedReplyOptions: ['YES', 'NO', 'CANNOT_SPEAK', 'HELP_REQUESTED', 'UNKNOWN'],
        statusMessageCode: 'awaiting_structured_response'
      }
    };
    await this.persist();
    return this.current;
  }

  async respond(options: readonly HumanContactReplyOption[]): Promise<FieldCompanionState> {
    this.requireConsent();
    const promptId = this.current.session.activePromptId;
    if (promptId === null) throw new Error('لا يوجد سؤال نشط للرد عليه');
    const selected = validateReplyOptions(options, this.current.session.allowedReplyOptions);
    const operation = this.operation('STRUCTURED_REPLY', {
      promptId,
      promptVersion: 1,
      selectedOptions: selected,
      occurredAt: this.now().toISOString()
    });
    this.enqueue(operation);
    this.current = {
      ...this.current,
      session: {
        ...this.current.session,
        contactState: selected.includes('HELP_REQUESTED') || selected.includes('CANNOT_SPEAK') ? 'HUMAN_REVIEW' : 'PARTIAL_RESPONSE',
        phase: selected.includes('HELP_REQUESTED') || selected.includes('CANNOT_SPEAK') ? 'HUMAN_REVIEW' : phaseForNetwork(this.current.device.network, 'READY'),
        statusMessageCode: selected.includes('HELP_REQUESTED') ? 'help_requested_human_review' : selected.includes('CANNOT_SPEAK') ? 'cannot_speak_human_review' : 'reply_queued'
      }
    };
    await this.persist();
    if (this.current.device.network !== 'OFFLINE') await this.flush();
    return this.current;
  }

  async updateDevice(update: Partial<Omit<FieldCompanionDeviceSnapshot, 'appInstanceId' | 'observedAt'>>): Promise<FieldCompanionState> {
    this.requireBooted();
    const next: FieldCompanionDeviceSnapshot = validateDevice({
      ...this.current.device,
      ...update,
      observedAt: this.now().toISOString()
    });
    this.current = {
      ...this.current,
      device: next,
      session: {
        ...this.current.session,
        phase: phaseForNetwork(next.network, this.current.session.phase),
        statusMessageCode: deviceStatusCode(next)
      }
    };
    await this.persist();
    if (next.network !== 'OFFLINE') await this.flush();
    return this.current;
  }

  async shareDeviceMetadata(): Promise<FieldCompanionState> {
    this.requireShareAuthority();
    const snapshot = this.current.device;
    const operation = this.operation('DEVICE_METADATA', {
      network: snapshot.network,
      battery: snapshot.battery,
      locationQuality: snapshot.locationQuality,
      motion: snapshot.motion,
      clockSkewBucket: Math.abs(snapshot.clockSkewMs) <= HUMAN_CONTACT_REPLY_MAX_CLOCK_SKEW_MS ? 'WITHIN_POLICY' : 'OUTSIDE_POLICY',
      observedAt: snapshot.observedAt,
      sharedCategories: ['DEVICE_CONDITION', 'MOTION_INDICATOR', 'LOCATION_QUALITY_ONLY']
    });
    this.enqueue(operation);
    await this.persist();
    if (snapshot.network !== 'OFFLINE') await this.flush();
    return this.current;
  }

  async reconnect(): Promise<FieldCompanionState> {
    this.requireBooted();
    if (this.current.device.network === 'OFFLINE') throw new Error('لا يمكن إعادة الاتصال قبل عودة الشبكة');
    this.enqueue(this.operation('RECONNECT', {}));
    await this.persist();
    await this.flush();
    return this.current;
  }

  async receiveOperatorTakeover(operatorLabel = 'مشغل السلامة'): Promise<FieldCompanionState> {
    this.requireBooted();
    this.current = {
      ...this.current,
      session: {
        ...this.current.session,
        contactState: 'OPERATOR_TAKEOVER',
        phase: 'OPERATOR_TAKEOVER',
        operatorTakeoverVisible: true,
        activePromptId: null,
        allowedReplyOptions: [],
        statusMessageCode: `operator_takeover:${safeLabel(operatorLabel)}`
      }
    };
    await this.persist();
    return this.current;
  }

  async complete(): Promise<FieldCompanionState> {
    this.requireBooted();
    this.current = {
      ...this.current,
      session: { ...this.current.session, contactState: 'COMPLETED', phase: 'COMPLETED', activePromptId: null, allowedReplyOptions: [], statusMessageCode: 'contact_completed' }
    };
    await this.persist();
    return this.current;
  }

  async flush(): Promise<FieldCompanionState> {
    this.requireBooted();
    if (this.current.device.network === 'OFFLINE') return this.current;
    const remaining: FieldCompanionQueuedOperation[] = [];
    const acknowledged = new Set(this.current.acknowledgedIdempotencyKeys);
    for (const operation of this.current.pending) {
      if (Date.parse(operation.expiresAt) <= this.now().getTime()) continue;
      if (acknowledged.has(operation.idempotencyKey)) continue;
      try {
        const receipt = await this.gateway.deliver({ tenantId: this.current.session.tenantId, caseId: this.current.session.caseId, sessionId: this.current.session.sessionId, operation });
        acknowledged.add(receipt.idempotencyKey);
        this.applyReceipt(receipt);
      } catch {
        remaining.push({ ...operation, attemptCount: operation.attemptCount + 1 });
        if (this.current.device.network === 'DEGRADED') break;
      }
    }
    const unprocessed = this.current.pending.filter((candidate) => !remaining.some((item) => item.operationId === candidate.operationId) && !acknowledged.has(candidate.idempotencyKey) && Date.parse(candidate.expiresAt) > this.now().getTime());
    this.current = { ...this.current, pending: uniqueOperations([...remaining, ...unprocessed]), acknowledgedIdempotencyKeys: [...acknowledged].slice(-200) };
    await this.persist();
    return this.current;
  }

  sharedDataSummary(): readonly { category: FieldCompanionShareCategory; description: string }[] {
    return [
      { category: 'CONTACT_STATUS', description: 'حالة التواصل والموافقة دون نص المحادثة' },
      { category: 'STRUCTURED_REPLY', description: 'خيارات محددة فقط، دون كتابة حرة' },
      { category: 'DEVICE_CONDITION', description: 'حالة الشبكة والبطارية' },
      { category: 'MOTION_INDICATOR', description: 'مؤشر حركة مصنف، دون بيانات حساسات خام' },
      { category: 'LOCATION_QUALITY_ONLY', description: 'جودة الموقع فقط؛ لا يعرض التطبيق الإحداثيات الدقيقة' }
    ];
  }

  privacySafeTelemetry(): Readonly<Record<string, string | number | boolean>> {
    return {
      schemaVersion: FIELD_COMPANION_SCHEMA_VERSION,
      phase: this.current.session.phase,
      contactState: this.current.session.contactState,
      network: this.current.device.network,
      battery: this.current.device.battery,
      locationQuality: this.current.device.locationQuality,
      motion: this.current.device.motion,
      pendingOperationCount: this.current.pending.length,
      operatorTakeoverVisible: this.current.session.operatorTakeoverVisible,
      simulation: true
    };
  }

  private operation(kind: FieldCompanionOperationKind, payload: FieldCompanionQueuedOperation['payload']): FieldCompanionQueuedOperation {
    const createdAt = this.now().toISOString();
    const operationId = this.ids.create('field-op');
    return { operationId, idempotencyKey: this.ids.create('field-idem'), kind, createdAt, expiresAt: new Date(Date.parse(createdAt) + FIELD_COMPANION_LOCAL_RETENTION_MS).toISOString(), attemptCount: 0, payload };
  }

  private enqueue(operation: FieldCompanionQueuedOperation): void {
    if (this.current.pending.length >= FIELD_COMPANION_MAX_QUEUE) throw new Error('قائمة الإرسال المحلية ممتلئة؛ يلزم تدخل بشري');
    this.current = { ...this.current, pending: [...this.current.pending, operation] };
  }

  private applyReceipt(receipt: FieldCompanionDeliveryReceipt): void {
    const phase: FieldCompanionPhase = receipt.disposition === 'OPERATOR_TAKEOVER' ? 'OPERATOR_TAKEOVER'
      : receipt.disposition === 'HUMAN_REVIEW' ? 'HUMAN_REVIEW'
      : receipt.contactState === 'COMPLETED' ? 'COMPLETED' : phaseForNetwork(this.current.device.network, 'READY');
    this.current = {
      ...this.current,
      session: {
        ...this.current.session,
        contactState: receipt.contactState,
        phase,
        operatorTakeoverVisible: receipt.disposition === 'OPERATOR_TAKEOVER' || this.current.session.operatorTakeoverVisible,
        statusMessageCode: receipt.statusMessageCode,
        lastServerReceiptAt: receipt.receivedAt
      }
    };
  }

  private async persist(): Promise<void> {
    const persisted: FieldCompanionPersistedState = {
      schemaVersion: FIELD_COMPANION_SCHEMA_VERSION,
      privacyPolicyVersion: FIELD_COMPANION_PRIVACY_POLICY_VERSION,
      savedAt: this.now().toISOString(),
      session: this.current.session,
      device: this.current.device,
      pending: this.current.pending,
      acknowledgedIdempotencyKeys: this.current.acknowledgedIdempotencyKeys
    };
    await this.storage.save(this.storageKey, persisted);
    this.current = { ...persisted, error: this.current.error, privacyNotice: privacyNotice() };
  }

  private requireBooted(): void { if (this.current.session.phase === 'FAILURE' || this.current.session.phase === 'BOOTING') throw new Error('التطبيق غير جاهز'); }
  private requireConsent(): void { this.requireBooted(); if (this.current.session.consent !== 'GRANTED' && this.current.session.consent !== 'EMERGENCY_SAFETY_REVIEW') throw new Error('الموافقة مطلوبة قبل مشاركة الرد'); }
  private requireShareAuthority(): void { this.requireConsent(); if (Math.abs(this.current.device.clockSkewMs) > HUMAN_CONTACT_REPLY_MAX_CLOCK_SKEW_MS) throw new Error('وقت الجهاز غير موثوق؛ تم منع مشاركة بيانات الجهاز'); }
}

export class MemoryFieldCompanionStorage implements FieldCompanionStorage {
  private readonly values = new Map<string, FieldCompanionPersistedState>();
  async load(key: string): Promise<FieldCompanionPersistedState | null> { const value = this.values.get(key); return value === undefined ? null : structuredClone(value); }
  async save(key: string, state: FieldCompanionPersistedState): Promise<void> { this.values.set(key, structuredClone(state)); }
  async clear(key: string): Promise<void> { this.values.delete(key); }
}

export class BrowserFieldCompanionStorage implements FieldCompanionStorage {
  async load(key: string): Promise<FieldCompanionPersistedState | null> {
    const value = localStorage.getItem(key);
    if (value === null) return null;
    try { return JSON.parse(value) as FieldCompanionPersistedState; } catch { localStorage.removeItem(key); return null; }
  }
  async save(key: string, state: FieldCompanionPersistedState): Promise<void> { localStorage.setItem(key, JSON.stringify(state)); }
  async clear(key: string): Promise<void> { localStorage.removeItem(key); }
}

export class SequentialFieldCompanionIdFactory implements FieldCompanionIdFactory {
  private sequence = 0;
  create(prefix: string): string { this.sequence += 1; return `${prefix}-${this.sequence.toString().padStart(6, '0')}`; }
}

export class SimulatedFieldCompanionGateway implements FieldCompanionGateway {
  readonly deliveries: FieldCompanionQueuedOperation[] = [];
  private readonly receipts = new Map<string, FieldCompanionDeliveryReceipt>();
  unavailable = false;

  async deliver(input: { readonly tenantId: string; readonly caseId: string; readonly sessionId: string; readonly operation: FieldCompanionQueuedOperation }): Promise<FieldCompanionDeliveryReceipt> {
    if (this.unavailable) throw new Error('simulated gateway unavailable');
    const existing = this.receipts.get(input.operation.idempotencyKey);
    if (existing !== undefined) return { ...existing, disposition: 'DUPLICATE' };
    this.deliveries.push(structuredClone(input.operation));
    const disposition = deliveryDisposition(input.operation);
    const receipt: FieldCompanionDeliveryReceipt = {
      idempotencyKey: input.operation.idempotencyKey,
      disposition,
      contactState: disposition === 'OPERATOR_TAKEOVER' ? 'OPERATOR_TAKEOVER' : disposition === 'HUMAN_REVIEW' ? 'HUMAN_REVIEW' : 'AWAITING_RESPONSE',
      statusMessageCode: disposition === 'OPERATOR_TAKEOVER' ? 'operator_takeover_requested' : disposition === 'HUMAN_REVIEW' ? 'human_review_requested' : 'delivery_accepted',
      receivedAt: new Date().toISOString()
    };
    this.receipts.set(input.operation.idempotencyKey, receipt);
    return receipt;
  }
}

export class FieldDeviceSimulator {
  constructor(private snapshot: FieldCompanionDeviceSnapshot) {}
  current(): FieldCompanionDeviceSnapshot { return structuredClone(this.snapshot); }
  network(value: FieldCompanionNetwork, at: string): FieldCompanionDeviceSnapshot { return this.update({ network: value, observedAt: at }); }
  battery(value: FieldCompanionBattery, at: string): FieldCompanionDeviceSnapshot { return this.update({ battery: value, observedAt: at }); }
  motion(value: FieldCompanionMotion, at: string): FieldCompanionDeviceSnapshot { return this.update({ motion: value, observedAt: at }); }
  location(value: FieldCompanionLocationQuality, at: string): FieldCompanionDeviceSnapshot { return this.update({ locationQuality: value, observedAt: at }); }
  clockSkew(value: number, at: string): FieldCompanionDeviceSnapshot { return this.update({ clockSkewMs: value, observedAt: at }); }
  restart(newInstanceId: string, at: string): FieldCompanionDeviceSnapshot { return this.update({ appInstanceId: newInstanceId, observedAt: at }); }
  private update(value: Partial<FieldCompanionDeviceSnapshot>): FieldCompanionDeviceSnapshot { this.snapshot = validateDevice({ ...this.snapshot, ...value }); return this.current(); }
}

function initialState(input: FieldCompanionBootstrap): FieldCompanionState {
  const device: FieldCompanionDeviceSnapshot = { network: 'ONLINE', battery: 'NORMAL', locationQuality: 'APPROXIMATE', motion: 'STABLE', clockSkewMs: 0, observedAt: input.now, appInstanceId: input.appInstanceId };
  const session: FieldCompanionSession = { tenantId: input.tenantId, caseId: input.caseId, sessionId: input.sessionId, language: input.language, contactState: 'CONSENT_PENDING', phase: 'READY', consent: 'NOT_REQUESTED', activePromptId: 'contact.consent', allowedReplyOptions: ['YES', 'NO', 'UNKNOWN'], operatorTakeoverVisible: false, simulation: true, statusMessageCode: 'consent_pending', lastServerReceiptAt: null };
  return { schemaVersion: FIELD_COMPANION_SCHEMA_VERSION, privacyPolicyVersion: FIELD_COMPANION_PRIVACY_POLICY_VERSION, savedAt: input.now, session, device, pending: [], acknowledgedIdempotencyKeys: [], error: null, privacyNotice: privacyNotice() };
}

function failureState(code: string): FieldCompanionState {
  const at = new Date(0).toISOString();
  return { schemaVersion: FIELD_COMPANION_SCHEMA_VERSION, privacyPolicyVersion: FIELD_COMPANION_PRIVACY_POLICY_VERSION, savedAt: at, session: { tenantId: 'invalid', caseId: 'invalid', sessionId: 'invalid', language: 'ar', contactState: 'HUMAN_REVIEW', phase: 'FAILURE', consent: 'NOT_REQUESTED', activePromptId: null, allowedReplyOptions: [], operatorTakeoverVisible: false, simulation: true, statusMessageCode: code, lastServerReceiptAt: null }, device: { network: 'OFFLINE', battery: 'CRITICAL', locationQuality: 'UNAVAILABLE', motion: 'STABLE', clockSkewMs: 0, observedAt: at, appInstanceId: 'invalid' }, pending: [], acknowledgedIdempotencyKeys: [], error: code, privacyNotice: privacyNotice() };
}

function validPersisted(value: FieldCompanionPersistedState, input: FieldCompanionBootstrap, now: Date): boolean {
  return value.schemaVersion === FIELD_COMPANION_SCHEMA_VERSION && value.privacyPolicyVersion === FIELD_COMPANION_PRIVACY_POLICY_VERSION
    && value.session.tenantId === input.tenantId && value.session.caseId === input.caseId && value.session.sessionId === input.sessionId
    && Number.isFinite(Date.parse(value.savedAt)) && now.getTime() - Date.parse(value.savedAt) <= FIELD_COMPANION_LOCAL_RETENTION_MS
    && value.pending.length <= FIELD_COMPANION_MAX_QUEUE;
}

function validateBootstrap(input: FieldCompanionBootstrap): void {
  for (const value of [input.tenantId, input.caseId, input.sessionId, input.appInstanceId]) if (!validId(value)) throw new Error('معرّفات بدء التطبيق غير صالحة');
  if (!Number.isFinite(Date.parse(input.now))) throw new Error('وقت بدء التطبيق غير صالح');
}

function validateDevice(value: FieldCompanionDeviceSnapshot): FieldCompanionDeviceSnapshot {
  if (!Number.isFinite(value.clockSkewMs) || Math.abs(value.clockSkewMs) > 24 * 60 * 60 * 1000) throw new Error('انحراف وقت الجهاز غير صالح');
  if (!Number.isFinite(Date.parse(value.observedAt)) || !validId(value.appInstanceId)) throw new Error('بيانات الجهاز غير صالحة');
  return Object.freeze({ ...value });
}

function validateReplyOptions(selected: readonly HumanContactReplyOption[], allowed: readonly HumanContactReplyOption[]): readonly HumanContactReplyOption[] {
  const unique = [...new Set(selected)];
  if (unique.length === 0 || unique.length > 3 || unique.some((option) => !allowed.includes(option))) throw new Error('الرد المنظم غير صالح');
  if (unique.includes('YES') && unique.includes('NO')) throw new Error('الرد يحتوي خيارات متعارضة');
  return unique;
}

function deliveryDisposition(operation: FieldCompanionQueuedOperation): FieldCompanionDeliveryReceipt['disposition'] {
  if (operation.kind !== 'STRUCTURED_REPLY') return 'ACCEPTED';
  const reply = operation.payload as FieldCompanionStructuredReply;
  if (reply.selectedOptions.includes('HELP_REQUESTED') || reply.selectedOptions.includes('CANNOT_SPEAK')) return 'OPERATOR_TAKEOVER';
  if (reply.selectedOptions.includes('UNKNOWN')) return 'HUMAN_REVIEW';
  return 'ACCEPTED';
}

function phaseForNetwork(network: FieldCompanionNetwork, current: FieldCompanionPhase): FieldCompanionPhase {
  if (current === 'OPERATOR_TAKEOVER' || current === 'HUMAN_REVIEW' || current === 'COMPLETED') return current;
  return network === 'OFFLINE' ? 'OFFLINE' : 'READY';
}

function deviceStatusCode(device: FieldCompanionDeviceSnapshot): string {
  if (device.network === 'OFFLINE') return 'offline_queue_active';
  if (device.battery === 'CRITICAL') return 'critical_battery_reduce_activity';
  if (Math.abs(device.clockSkewMs) > HUMAN_CONTACT_REPLY_MAX_CLOCK_SKEW_MS) return 'device_time_untrusted';
  if (device.locationQuality === 'UNAVAILABLE') return 'location_quality_unavailable';
  return 'device_status_updated';
}

function uniqueOperations(items: readonly FieldCompanionQueuedOperation[]): readonly FieldCompanionQueuedOperation[] {
  const seen = new Set<string>();
  return items.filter((item) => seen.has(item.idempotencyKey) ? false : (seen.add(item.idempotencyKey), true));
}

function privacyNotice(): readonly string[] { return ['لا يتم عرض أو حفظ إحداثيات دقيقة في الواجهة العامة.', 'لا توجد كتابة حرة أو نص طبي في مسار الرد.', 'المحاكاة لا تعني اتصالًا حقيقيًا بجهة طوارئ.', 'يمكنك رؤية فئات البيانات المشتركة وسبب مشاركتها.']; }
function validId(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(value); }
function safeLabel(value: string): string { return value.replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 80); }
