export type PlaceCategory =
  | 'neighborhood'
  | 'pickup_point'
  | 'market'
  | 'historical_stand';

export type SuggestionStatus =
  | 'pending'
  | 'field_check'
  | 'approved'
  | 'rejected';

export type AiVerdict = 'auto_approve' | 'field_check' | 'needs_review';

export type VehicleType = 'microbus' | 'service' | 'tram' | 'bus';

export type ReportTargetType = 'route' | 'place' | 'general';

export type ReportType =
  | 'fare_change'
  | 'route_change'
  | 'service_stop'
  | 'data_issue';

export type ReportStatus = 'open' | 'in_review' | 'resolved' | 'dismissed';

export const ALEXANDRIA_ZONES = [
  'شرق الإسكندرية',
  'وسط الإسكندرية',
  'غرب الإسكندرية',
  'العامرية وبرج العرب',
] as const;

export const PLACE_CATEGORY_LABELS: Record<PlaceCategory, string> = {
  neighborhood: 'حي سكني',
  pickup_point: 'نقطة ركوب / موقف خدمة',
  market: 'سوق',
  historical_stand: 'موقف ميكروباص تاريخي',
};

export const SUGGESTION_STATUS_LABELS: Record<SuggestionStatus, string> = {
  pending: 'بانتظار المراجعة',
  field_check: 'تحقق ميداني',
  approved: 'معتمد ومنشور',
  rejected: 'مرفوض',
};

export const AI_VERDICT_LABELS: Record<AiVerdict, string> = {
  auto_approve: 'توصية بنشر تلقائي',
  field_check: 'يوصى بتحقق ميداني',
  needs_review: 'يحتاج مراجعة بشرية',
};

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  microbus: 'ميكروباص',
  service: 'سرفيس',
  tram: 'ترام',
  bus: 'أتوبيس',
};

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  fare_change: 'اختلاف الأجرة',
  route_change: 'تعديل المسار',
  service_stop: 'توقف الخدمة',
  data_issue: 'تصحيح بيانات',
};

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  open: 'بلاغ جديد',
  in_review: 'قيد المراجعة',
  resolved: 'تمت المعالجة',
  dismissed: 'مغلق',
};

// Boundary constants synced with firebase-blueprint.json & firestore.rules
export const SCHEMA_LIMITS = {
  ID_PATTERN: /^[a-zA-Z0-9_\-]+$/,
  NAME_MIN: 2,
  NAME_MAX: 120,
  DISTRICT_MIN: 2,
  DISTRICT_MAX: 100,
  LANDMARK_MAX: 200,
  ROUTE_NAME_MIN: 4,
  ROUTE_NAME_MAX: 200,
  NOTE_MAX: 500,
  DETAILS_MIN: 5,
  DETAILS_MAX: 1000,
  MIN_STOPS: 2,
  MAX_STOPS: 25,
  FARE_MIN: 1,
  FARE_MAX: 500,
  MINUTES_MIN: 1,
  MINUTES_MAX: 300,
  LAT_MIN: 29.5,
  LAT_MAX: 32.0,
  LNG_MIN: 28.5,
  LNG_MAX: 31.5,
} as const;

export interface VerifiedPlace {
  id: string;
  name: string;
  category: PlaceCategory;
  district: string;
  landmarkHint?: string;
  lat?: number;
  lng?: number;
  sourceNote?: string;
  sourceSuggestionId?: string;
  verifiedByUid: string;
  verifiedAt: string;
  isActive: boolean;
}

export interface VerifiedRoute {
  id: string;
  name: string;
  direction: string;
  originPlaceId: string;
  destinationPlaceId: string;
  stopIds: string[];
  stopNames: string[];
  fareEgp: number;
  estimatedMinutes: number;
  vehicleType: VehicleType;
  notes?: string;
  isActive: boolean;
  verifiedByUid: string;
  publishedAt: string;
}

export interface PlaceSuggestion {
  id: string;
  name: string;
  category: PlaceCategory;
  district: string;
  landmarkHint?: string;
  lat?: number;
  lng?: number;
  status: SuggestionStatus;
  sourceReference?: string;
  fieldNotes?: string;
  reviewNote?: string;
  aiConfidence?: number;
  aiVerdict?: AiVerdict;
  aiReasoning?: string;
  submittedByUid: string;
  isInitialSeed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RouteSuggestion {
  id: string;
  generatedName: string;
  generatedDirection: string;
  stopIds: string[];
  stopNames: string[];
  fareEgp: number;
  estimatedMinutes: number;
  vehicleType: VehicleType;
  notes?: string;
  status: SuggestionStatus;
  reviewNote?: string;
  aiConfidence?: number;
  aiVerdict?: AiVerdict;
  aiReasoning?: string;
  submittedByUid: string;
  createdAt: string;
  updatedAt: string;
}

export interface TransitReport {
  id: string;
  targetType: ReportTargetType;
  targetId?: string;
  targetLabel?: string;
  reportType: ReportType;
  details: string;
  suggestedFareEgp?: number;
  status: ReportStatus;
  reviewNote?: string;
  submittedByUid: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUser {
  uid: string;
  displayName: string;
  email: string;
  addedByUid?: string;
  createdAt: string;
}

export interface PublicStats {
  verifiedPlacesCount: number;
  publishedRoutesCount: number;
  pendingSuggestionsCount: number;
  fieldCheckCount: number;
  initialSeedApplied: boolean;
  updatedAt: string;
}

export interface TripLeg {
  route: VerifiedRoute;
  fromPlace: VerifiedPlace;
  toPlace: VerifiedPlace;
  subStops: VerifiedPlace[];
  fareEgp: number;
  estimatedMinutes: number;
}

export interface TripOption {
  id: string;
  type: 'direct' | 'transfer';
  legs: TripLeg[];
  transferPlace?: VerifiedPlace;
  totalFarePerRiderEgp: number;
  totalMinutes: number;
  transferWaitMinutes: number;
  stopCount: number;
}

export type AuditLogLevel = 'info' | 'success' | 'warning' | 'error';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  level: AuditLogLevel;
  title: string;
  details?: string;
}

export interface HybridAuditProgress {
  running: boolean;
  processed: number;
  total: number;
  autoApproved: number;
  sentToFieldCheck: number;
  needsReview: number;
  failedChunks: number;
}


