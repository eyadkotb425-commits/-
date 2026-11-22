import {
  AiVerdict,
  PlaceCategory,
  VerifiedPlace,
  VerifiedRoute,
} from '../types/transit';

export interface TripAssistantResponse {
  replyArabic: string;
  matchedOriginId: string;
  matchedDestinationId: string;
  estimatedSummary: string;
  confidenceNote: string;
}

export interface SuggestionEvaluationResponse {
  confidence: number;
  verdict: AiVerdict;
  normalizedDistrict: string;
  suggestedCategory: PlaceCategory;
  reasoning: string;
  attempts?: number;
  latencyMs?: number;
}

export interface BatchAuditResultItem {
  id: string;
  confidence: number;
  verdict: AiVerdict;
  reasoning: string;
}

export class AiApiError extends Error {
  status: number;
  code: string;
  retryable: boolean;

  constructor(message: string, status: number, code: string, retryable: boolean) {
    super(message);
    this.name = 'AiApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new AiApiError(
      'أنت حاليًا في وضع عدم الاتصال بالإنترنت. يتطلب المساعد والمدقق الذكي اتصالًا بالشبكة.',
      0,
      'OFFLINE',
      true
    );
  }

  let res: Response;
  try {
    const timeoutSignal =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(35000)
        : undefined;
    res = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
      signal: timeoutSignal,
    });
  } catch (err) {
    const isTimeout =
      err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new AiApiError(
      isTimeout
        ? 'انتهت مهلة انتظار خادم الذكاء الاصطناعي (35 ثانية). يمكنك إعادة محاولة الدفعة المتبقية الآن.'
        : 'تعذر الوصول إلى خادم الذكاء الاصطناعي. تحقق من الاتصال ثم أعد المحاولة.',
      isTimeout ? 504 : 0,
      isTimeout ? 'CLIENT_TIMEOUT' : 'NETWORK_ERROR',
      true
    );
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const errMsg =
      typeof data.error === 'string' && data.error
        ? data.error
        : `تعذر إتمام الطلب (${res.status}).`;
    const code = typeof data.code === 'string' ? data.code : `HTTP_${res.status}`;
    const retryable =
      typeof data.retryable === 'boolean'
        ? data.retryable
        : res.status === 503 || res.status === 429 || res.status >= 500;
    throw new AiApiError(errMsg, res.status, code, retryable);
  }
  return data as T;
}

export async function askAiTripAssistant(input: {
  question: string;
  places: VerifiedPlace[];
  routes: VerifiedRoute[];
  pendingSuggestionsCount: number;
}): Promise<TripAssistantResponse> {
  return postJson<TripAssistantResponse>('/api/ai/trip-assistant', {
    question: input.question,
    places: input.places.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      district: p.district,
      landmarkHint: p.landmarkHint,
    })),
    routes: input.routes.map((r) => ({
      id: r.id,
      name: r.name,
      direction: r.direction,
      stopIds: r.stopIds,
      stopNames: r.stopNames,
      fareEgp: r.fareEgp,
      estimatedMinutes: r.estimatedMinutes,
      vehicleType: r.vehicleType,
      notes: r.notes,
    })),
    pendingSuggestionsCount: input.pendingSuggestionsCount,
  });
}

export async function evaluateSuggestionWithAi(input: {
  kind: 'place' | 'route';
  item: Record<string, unknown>;
  existingNames: string[];
}): Promise<SuggestionEvaluationResponse> {
  return postJson<SuggestionEvaluationResponse>('/api/ai/evaluate-suggestion', input);
}

export async function auditPlaceSuggestionsBatch(input: {
  items: Array<{
    id: string;
    name: string;
    category: string;
    district: string;
    landmarkHint?: string;
    sourceReference?: string;
    fieldNotes?: string;
  }>;
  existingVerifiedNames: string[];
}): Promise<{results: BatchAuditResultItem[]; attempts?: number; latencyMs?: number}> {
  return postJson<{
    results: BatchAuditResultItem[];
    attempts?: number;
    latencyMs?: number;
  }>('/api/ai/audit-batch', input);
}
