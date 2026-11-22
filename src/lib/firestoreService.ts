import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  INITIAL_60_SUGGESTIONS,
  SeedPlaceSuggestion,
} from '../data/initialSuggestions';
import {
  AdminUser,
  AiVerdict,
  PlaceCategory,
  PlaceSuggestion,
  PublicStats,
  ReportStatus,
  ReportTargetType,
  ReportType,
  RouteSuggestion,
  SCHEMA_LIMITS,
  SuggestionStatus,
  TransitReport,
  VehicleType,
  VerifiedPlace,
  VerifiedRoute,
} from '../types/transit';
import {db, handleFirestoreError, OperationType} from './firebase';
import {generateRouteMeta} from './routing';

function toIsoString(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string') {
    return val;
  }
  return new Date().toISOString();
}

export function makeSafeId(prefix: string): string {
  const randomPart = Math.random().toString(36).slice(2, 8);
  const timePart = Date.now().toString(36);
  return `${prefix}-${timePart}-${randomPart}`.replace(/[^a-zA-Z0-9_\-]/g, '');
}

function cleanOptionalCoords(
  lat?: number,
  lng?: number
): {lat?: number; lng?: number} {
  if (
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    typeof lng === 'number' &&
    Number.isFinite(lng)
  ) {
    return {
      lat: Number(
        Math.min(SCHEMA_LIMITS.LAT_MAX, Math.max(SCHEMA_LIMITS.LAT_MIN, lat)).toFixed(
          6
        )
      ),
      lng: Number(
        Math.min(SCHEMA_LIMITS.LNG_MAX, Math.max(SCHEMA_LIMITS.LNG_MIN, lng)).toFixed(
          6
        )
      ),
    };
  }
  return {};
}

function cleanStr(value: string, maxLen: number): string {
  return value.trim().slice(0, maxLen);
}

const OFFLINE_CACHE_KEY = 'mashroei_alex_transit_cache_v1';

export interface OfflineTransitSnapshot {
  places: VerifiedPlace[];
  routes: VerifiedRoute[];
  stats: PublicStats | null;
  savedAt: string;
}

export function saveOfflineTransitCache(
  partial: Partial<Omit<OfflineTransitSnapshot, 'savedAt'>>
): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const existing = loadOfflineTransitCache();
    const next: OfflineTransitSnapshot = {
      places: partial.places ?? existing?.places ?? [],
      routes: partial.routes ?? existing?.routes ?? [],
      stats: partial.stats !== undefined ? partial.stats : (existing?.stats ?? null),
      savedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(OFFLINE_CACHE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadOfflineTransitCache(): OfflineTransitSnapshot | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(OFFLINE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OfflineTransitSnapshot>;
    return {
      places: Array.isArray(parsed.places) ? parsed.places : [],
      routes: Array.isArray(parsed.routes) ? parsed.routes : [],
      stats: parsed.stats ?? null,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
    };
  } catch {
    return null;
  }
}

// --- Real-time Subscriptions ---

export function subscribeVerifiedPlaces(
  onData: (places: VerifiedPlace[]) => void
): () => void {
  const path = 'places';
  const q = query(collection(db, path), where('isActive', '==', true));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: VerifiedPlace[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id ?? d.id),
          name: String(data.name ?? ''),
          category: data.category as PlaceCategory,
          district: String(data.district ?? ''),
          landmarkHint: data.landmarkHint ? String(data.landmarkHint) : undefined,
          lat: typeof data.lat === 'number' ? Number(data.lat) : undefined,
          lng: typeof data.lng === 'number' ? Number(data.lng) : undefined,
          sourceNote: data.sourceNote ? String(data.sourceNote) : undefined,
          sourceSuggestionId: data.sourceSuggestionId
            ? String(data.sourceSuggestionId)
            : undefined,
          verifiedByUid: String(data.verifiedByUid ?? ''),
          verifiedAt: toIsoString(data.verifiedAt),
          isActive: Boolean(data.isActive),
        };
      });
      items.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
      if (items.length > 0 || !snapshot.metadata.fromCache) {
        saveOfflineTransitCache({places: items});
      }
      onData(items);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export function subscribeVerifiedRoutes(
  onData: (routes: VerifiedRoute[]) => void
): () => void {
  const path = 'routes';
  const q = query(collection(db, path), where('isActive', '==', true));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: VerifiedRoute[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id ?? d.id),
          name: String(data.name ?? ''),
          direction: String(data.direction ?? ''),
          originPlaceId: String(data.originPlaceId ?? ''),
          destinationPlaceId: String(data.destinationPlaceId ?? ''),
          stopIds: Array.isArray(data.stopIds) ? data.stopIds.map(String) : [],
          stopNames: Array.isArray(data.stopNames)
            ? data.stopNames.map(String)
            : [],
          fareEgp: Number(data.fareEgp ?? 0),
          estimatedMinutes: Number(data.estimatedMinutes ?? 0),
          vehicleType: (data.vehicleType as VehicleType) || 'microbus',
          notes: data.notes ? String(data.notes) : undefined,
          isActive: Boolean(data.isActive),
          verifiedByUid: String(data.verifiedByUid ?? ''),
          publishedAt: toIsoString(data.publishedAt),
        };
      });
      items.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
      if (items.length > 0 || !snapshot.metadata.fromCache) {
        saveOfflineTransitCache({routes: items});
      }
      onData(items);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export function subscribePublicStats(
  onData: (stats: PublicStats | null) => void
): () => void {
  const path = 'app_meta/public_stats';
  return onSnapshot(
    doc(db, 'app_meta', 'public_stats'),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const data = snap.data();
      const stats: PublicStats = {
        verifiedPlacesCount: Number(data.verifiedPlacesCount ?? 0),
        publishedRoutesCount: Number(data.publishedRoutesCount ?? 0),
        pendingSuggestionsCount: Number(data.pendingSuggestionsCount ?? 0),
        fieldCheckCount: Number(data.fieldCheckCount ?? 0),
        initialSeedApplied: Boolean(data.initialSeedApplied),
        updatedAt: toIsoString(data.updatedAt),
      };
      saveOfflineTransitCache({stats});
      onData(stats);
    },
    (error) => handleFirestoreError(error, OperationType.GET, path)
  );
}

export function subscribePlaceSuggestions(
  uid: string,
  isAdmin: boolean,
  onData: (items: PlaceSuggestion[]) => void
): () => void {
  const path = 'place_suggestions';
  const q = isAdmin
    ? query(collection(db, path), orderBy('createdAt', 'desc'))
    : query(collection(db, path), where('submittedByUid', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: PlaceSuggestion[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id ?? d.id),
          name: String(data.name ?? ''),
          category: data.category as PlaceCategory,
          district: String(data.district ?? ''),
          landmarkHint: data.landmarkHint ? String(data.landmarkHint) : undefined,
          lat: typeof data.lat === 'number' ? Number(data.lat) : undefined,
          lng: typeof data.lng === 'number' ? Number(data.lng) : undefined,
          status: data.status as SuggestionStatus,
          sourceReference: data.sourceReference
            ? String(data.sourceReference)
            : undefined,
          fieldNotes: data.fieldNotes ? String(data.fieldNotes) : undefined,
          reviewNote: data.reviewNote ? String(data.reviewNote) : undefined,
          aiConfidence:
            typeof data.aiConfidence === 'number'
              ? Number(data.aiConfidence)
              : undefined,
          aiVerdict: data.aiVerdict ? (data.aiVerdict as AiVerdict) : undefined,
          aiReasoning: data.aiReasoning ? String(data.aiReasoning) : undefined,
          submittedByUid: String(data.submittedByUid ?? ''),
          isInitialSeed: Boolean(data.isInitialSeed),
          createdAt: toIsoString(data.createdAt),
          updatedAt: toIsoString(data.updatedAt),
        };
      });
      items.sort((a, b) => a.id.localeCompare(b.id));
      onData(items);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export function subscribeRouteSuggestions(
  uid: string,
  isAdmin: boolean,
  onData: (items: RouteSuggestion[]) => void
): () => void {
  const path = 'route_suggestions';
  const q = isAdmin
    ? query(collection(db, path), orderBy('createdAt', 'desc'))
    : query(collection(db, path), where('submittedByUid', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: RouteSuggestion[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id ?? d.id),
          generatedName: String(data.generatedName ?? ''),
          generatedDirection: String(data.generatedDirection ?? ''),
          stopIds: Array.isArray(data.stopIds) ? data.stopIds.map(String) : [],
          stopNames: Array.isArray(data.stopNames)
            ? data.stopNames.map(String)
            : [],
          fareEgp: Number(data.fareEgp ?? 0),
          estimatedMinutes: Number(data.estimatedMinutes ?? 0),
          vehicleType: (data.vehicleType as VehicleType) || 'microbus',
          notes: data.notes ? String(data.notes) : undefined,
          status: data.status as SuggestionStatus,
          reviewNote: data.reviewNote ? String(data.reviewNote) : undefined,
          aiConfidence:
            typeof data.aiConfidence === 'number'
              ? Number(data.aiConfidence)
              : undefined,
          aiVerdict: data.aiVerdict ? (data.aiVerdict as AiVerdict) : undefined,
          aiReasoning: data.aiReasoning ? String(data.aiReasoning) : undefined,
          submittedByUid: String(data.submittedByUid ?? ''),
          createdAt: toIsoString(data.createdAt),
          updatedAt: toIsoString(data.updatedAt),
        };
      });
      onData(items);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export function subscribeReports(
  uid: string,
  isAdmin: boolean,
  onData: (items: TransitReport[]) => void
): () => void {
  const path = 'reports';
  const q = isAdmin
    ? query(collection(db, path), orderBy('createdAt', 'desc'))
    : query(collection(db, path), where('submittedByUid', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: TransitReport[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id ?? d.id),
          targetType: data.targetType as ReportTargetType,
          targetId: data.targetId ? String(data.targetId) : undefined,
          targetLabel: data.targetLabel ? String(data.targetLabel) : undefined,
          reportType: data.reportType as ReportType,
          details: String(data.details ?? ''),
          suggestedFareEgp:
            data.suggestedFareEgp !== undefined
              ? Number(data.suggestedFareEgp)
              : undefined,
          status: data.status as ReportStatus,
          reviewNote: data.reviewNote ? String(data.reviewNote) : undefined,
          submittedByUid: String(data.submittedByUid ?? ''),
          createdAt: toIsoString(data.createdAt),
          updatedAt: toIsoString(data.updatedAt),
        };
      });
      onData(items);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export async function checkUserAdminStatus(
  uid: string,
  email: string | null | undefined,
  emailVerified: boolean
): Promise<boolean> {
  if (!emailVerified) return false;
  if (email === 'eyadkotb425@gmail.com') return true;
  const path = `admins/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'admins', uid));
    return snap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeAdminsList(
  onData: (admins: AdminUser[]) => void
): () => void {
  const path = 'admins';
  return onSnapshot(
    collection(db, path),
    (snapshot) => {
      const items: AdminUser[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          uid: String(data.uid ?? d.id),
          displayName: String(data.displayName ?? ''),
          email: String(data.email ?? ''),
          addedByUid: data.addedByUid ? String(data.addedByUid) : undefined,
          createdAt: toIsoString(data.createdAt),
        };
      });
      onData(items);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

// --- Public Stats Synchronization (Admin Only) ---

export async function syncPublicStats(): Promise<void> {
  const path = 'app_meta/public_stats';
  try {
    const [placesSnap, routesSnap, suggestionsSnap] = await Promise.all([
      getDocs(collection(db, 'places')),
      getDocs(collection(db, 'routes')),
      getDocs(collection(db, 'place_suggestions')),
    ]);

    const verifiedPlacesCount = placesSnap.docs.filter(
      (d) => d.data().isActive === true
    ).length;
    const publishedRoutesCount = routesSnap.docs.filter(
      (d) => d.data().isActive === true
    ).length;

    let pendingSuggestionsCount = 0;
    let fieldCheckCount = 0;
    suggestionsSnap.docs.forEach((d) => {
      const st = d.data().status;
      if (st === 'pending') pendingSuggestionsCount += 1;
      if (st === 'field_check') fieldCheckCount += 1;
    });

    await setDoc(doc(db, 'app_meta', 'public_stats'), {
      verifiedPlacesCount,
      publishedRoutesCount,
      pendingSuggestionsCount,
      fieldCheckCount,
      initialSeedApplied:
        suggestionsSnap.size >= 60 || pendingSuggestionsCount + fieldCheckCount > 0,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// --- Idempotent Seeding of the 60 Initial Suggestions (Admin Only) ---

export async function seedInitialSuggestionsIfNeeded(
  adminUid: string,
  force = false
): Promise<{seeded: boolean; count: number}> {
  const statsPath = 'app_meta/public_stats';
  try {
    const existingSnap = await getDocs(collection(db, 'place_suggestions'));
    const existingIds = new Set(existingSnap.docs.map((d) => d.id));

    if (!force) {
      const statsSnap = await getDoc(doc(db, 'app_meta', 'public_stats'));
      if (
        statsSnap.exists() &&
        statsSnap.data().initialSeedApplied === true &&
        existingSnap.size >= 60
      ) {
        return {seeded: false, count: 0};
      }
    }

    const batch = writeBatch(db);
    let added = 0;

    for (const item of INITIAL_60_SUGGESTIONS) {
      if (existingIds.has(item.id)) continue;
      const ref = doc(db, 'place_suggestions', item.id);
      const coords = cleanOptionalCoords(item.lat, item.lng);
      batch.set(ref, {
        id: item.id,
        name: cleanStr(item.name, SCHEMA_LIMITS.NAME_MAX),
        category: item.category,
        district: cleanStr(item.district, SCHEMA_LIMITS.DISTRICT_MAX),
        landmarkHint: cleanStr(item.landmarkHint, SCHEMA_LIMITS.LANDMARK_MAX),
        ...coords,
        status: item.status,
        sourceReference: cleanStr(item.sourceReference, SCHEMA_LIMITS.NOTE_MAX),
        fieldNotes: cleanStr(item.fieldNotes, SCHEMA_LIMITS.NOTE_MAX),
        submittedByUid: adminUid,
        isInitialSeed: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      added += 1;
    }

    if (added > 0) {
      await batch.commit();
    }
    await syncPublicStats();
    return {seeded: added > 0, count: added};
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, statsPath);
  }
}

// --- Community Submissions ---

export async function submitPlaceSuggestion(input: {
  uid: string;
  name: string;
  category: PlaceCategory;
  district: string;
  landmarkHint?: string;
  sourceReference?: string;
  fieldNotes?: string;
  aiConfidence?: number;
  aiVerdict?: AiVerdict;
  aiReasoning?: string;
}): Promise<string> {
  const id = makeSafeId('place-sug');
  const path = `place_suggestions/${id}`;
  const name = cleanStr(input.name, SCHEMA_LIMITS.NAME_MAX);
  const district = cleanStr(input.district, SCHEMA_LIMITS.DISTRICT_MAX);
  if (name.length < SCHEMA_LIMITS.NAME_MIN) {
    throw new Error('اسم المكان يجب أن يكون حرفين على الأقل.');
  }
  if (district.length < SCHEMA_LIMITS.DISTRICT_MIN) {
    throw new Error('اسم المنطقة أو الحي مطلوب.');
  }

  const payload: Record<string, unknown> = {
    id,
    name,
    category: input.category,
    district,
    status: 'pending',
    submittedByUid: input.uid,
    isInitialSeed: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (input.landmarkHint?.trim()) {
    payload.landmarkHint = cleanStr(input.landmarkHint, SCHEMA_LIMITS.LANDMARK_MAX);
  }
  if (input.sourceReference?.trim()) {
    payload.sourceReference = cleanStr(input.sourceReference, SCHEMA_LIMITS.NOTE_MAX);
  }
  if (input.fieldNotes?.trim()) {
    payload.fieldNotes = cleanStr(input.fieldNotes, SCHEMA_LIMITS.NOTE_MAX);
  }
  if (
    typeof input.aiConfidence === 'number' &&
    Number.isFinite(input.aiConfidence)
  ) {
    payload.aiConfidence = Math.min(100, Math.max(0, Math.round(input.aiConfidence)));
  }
  if (input.aiVerdict) {
    payload.aiVerdict = input.aiVerdict;
  }
  if (input.aiReasoning?.trim()) {
    payload.aiReasoning = cleanStr(input.aiReasoning, SCHEMA_LIMITS.NOTE_MAX);
  }

  try {
    await setDoc(doc(db, 'place_suggestions', id), payload);
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function submitRouteSuggestion(input: {
  uid: string;
  stops: VerifiedPlace[];
  fareEgp: number;
  estimatedMinutes: number;
  vehicleType: VehicleType;
  notes?: string;
  aiConfidence?: number;
  aiVerdict?: AiVerdict;
  aiReasoning?: string;
}): Promise<string> {
  if (
    input.stops.length < SCHEMA_LIMITS.MIN_STOPS ||
    input.stops.length > SCHEMA_LIMITS.MAX_STOPS
  ) {
    throw new Error('يجب اختيار نقطتين موثقتين على الأقل لبناء الخط.');
  }
  const id = makeSafeId('route-sug');
  const path = `route_suggestions/${id}`;
  const {name, direction} = generateRouteMeta(input.stops);
  const fareEgp = Math.min(
    SCHEMA_LIMITS.FARE_MAX,
    Math.max(SCHEMA_LIMITS.FARE_MIN, Number(input.fareEgp))
  );
  const estimatedMinutes = Math.min(
    SCHEMA_LIMITS.MINUTES_MAX,
    Math.max(SCHEMA_LIMITS.MINUTES_MIN, Math.round(input.estimatedMinutes))
  );

  const payload: Record<string, unknown> = {
    id,
    generatedName: name,
    generatedDirection: direction,
    stopIds: input.stops.map((s) => s.id),
    stopNames: input.stops.map((s) => cleanStr(s.name, SCHEMA_LIMITS.NAME_MAX)),
    fareEgp,
    estimatedMinutes,
    vehicleType: input.vehicleType,
    status: 'pending',
    submittedByUid: input.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (input.notes?.trim()) {
    payload.notes = cleanStr(input.notes, SCHEMA_LIMITS.NOTE_MAX);
  }
  if (
    typeof input.aiConfidence === 'number' &&
    Number.isFinite(input.aiConfidence)
  ) {
    payload.aiConfidence = Math.min(100, Math.max(0, Math.round(input.aiConfidence)));
  }
  if (input.aiVerdict) {
    payload.aiVerdict = input.aiVerdict;
  }
  if (input.aiReasoning?.trim()) {
    payload.aiReasoning = cleanStr(input.aiReasoning, SCHEMA_LIMITS.NOTE_MAX);
  }

  try {
    await setDoc(doc(db, 'route_suggestions', id), payload);
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function submitTransitReport(input: {
  uid: string;
  targetType: ReportTargetType;
  targetId?: string;
  targetLabel?: string;
  reportType: ReportType;
  details: string;
  suggestedFareEgp?: number;
}): Promise<string> {
  const details = cleanStr(input.details, SCHEMA_LIMITS.DETAILS_MAX);
  if (details.length < SCHEMA_LIMITS.DETAILS_MIN) {
    throw new Error('يرجى كتابة تفاصيل البلاغ (5 أحرف على الأقل).');
  }

  const id = makeSafeId('rep');
  const path = `reports/${id}`;
  const payload: Record<string, unknown> = {
    id,
    targetType: input.targetType,
    reportType: input.reportType,
    details,
    status: 'open',
    submittedByUid: input.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (input.targetId?.trim()) {
    payload.targetId = cleanStr(input.targetId, 128);
  }
  if (input.targetLabel?.trim()) {
    payload.targetLabel = cleanStr(input.targetLabel, SCHEMA_LIMITS.ROUTE_NAME_MAX);
  }
  if (
    input.suggestedFareEgp !== undefined &&
    Number.isFinite(input.suggestedFareEgp) &&
    input.suggestedFareEgp >= SCHEMA_LIMITS.FARE_MIN
  ) {
    payload.suggestedFareEgp = Math.min(
      SCHEMA_LIMITS.FARE_MAX,
      Number(input.suggestedFareEgp)
    );
  }

  try {
    await setDoc(doc(db, 'reports', id), payload);
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

// --- Admin & Hybrid AI Review Actions ---

export async function updatePlaceSuggestionReview(input: {
  suggestionId: string;
  name: string;
  category: PlaceCategory;
  district: string;
  landmarkHint?: string;
  status: SuggestionStatus;
  sourceReference?: string;
  fieldNotes?: string;
  reviewNote?: string;
}): Promise<void> {
  const path = `place_suggestions/${input.suggestionId}`;
  const updatePayload: Record<string, unknown> = {
    name: cleanStr(input.name, SCHEMA_LIMITS.NAME_MAX),
    category: input.category,
    district: cleanStr(input.district, SCHEMA_LIMITS.DISTRICT_MAX),
    landmarkHint: cleanStr(input.landmarkHint ?? '', SCHEMA_LIMITS.LANDMARK_MAX),
    status: input.status,
    sourceReference: cleanStr(input.sourceReference ?? '', SCHEMA_LIMITS.NOTE_MAX),
    fieldNotes: cleanStr(input.fieldNotes ?? '', SCHEMA_LIMITS.NOTE_MAX),
    reviewNote: cleanStr(input.reviewNote ?? '', SCHEMA_LIMITS.NOTE_MAX),
    updatedAt: serverTimestamp(),
  };

  try {
    await updateDoc(doc(db, 'place_suggestions', input.suggestionId), updatePayload);
    await syncPublicStats();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function approveAndPublishPlaceSuggestion(input: {
  suggestion: PlaceSuggestion;
  adminUid: string;
  editedName?: string;
  editedCategory?: PlaceCategory;
  editedDistrict?: string;
  editedLandmarkHint?: string;
  reviewNote?: string;
}): Promise<string> {
  const placeId = makeSafeId('place');
  const coords = cleanOptionalCoords(input.suggestion.lat, input.suggestion.lng);
  const name = cleanStr(
    input.editedName ?? input.suggestion.name,
    SCHEMA_LIMITS.NAME_MAX
  );
  const district = cleanStr(
    input.editedDistrict ?? input.suggestion.district,
    SCHEMA_LIMITS.DISTRICT_MAX
  );
  const landmarkHint = cleanStr(
    input.editedLandmarkHint ?? input.suggestion.landmarkHint ?? '',
    SCHEMA_LIMITS.LANDMARK_MAX
  );
  const category = input.editedCategory ?? input.suggestion.category;

  const batch = writeBatch(db);
  batch.set(doc(db, 'places', placeId), {
    id: placeId,
    name,
    category,
    district,
    landmarkHint,
    ...coords,
    sourceNote: cleanStr(
      input.suggestion.sourceReference ?? input.suggestion.fieldNotes ?? '',
      SCHEMA_LIMITS.NOTE_MAX
    ),
    sourceSuggestionId: input.suggestion.id,
    verifiedByUid: input.adminUid,
    verifiedAt: serverTimestamp(),
    isActive: true,
  });

  batch.update(doc(db, 'place_suggestions', input.suggestion.id), {
    name,
    category,
    district,
    landmarkHint,
    status: 'approved',
    reviewNote: cleanStr(
      input.reviewNote || 'تمت المراجعة والاعتماد ونشره في دليل الأماكن الموثقة.',
      SCHEMA_LIMITS.NOTE_MAX
    ),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    await syncPublicStats();
    return placeId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `places/${placeId}`);
  }
}

export async function applyHybridBatchAudit(input: {
  adminUid: string;
  suggestions: PlaceSuggestion[];
  auditResults: Array<{
    id: string;
    confidence: number;
    verdict: AiVerdict;
    reasoning: string;
  }>;
}): Promise<{autoApproved: number; sentToFieldCheck: number; needsReview: number}> {
  const sugById = new Map(input.suggestions.map((s) => [s.id, s]));
  let autoApproved = 0;
  let sentToFieldCheck = 0;
  let needsReview = 0;

  // Each approved suggestion writes 2 docs; keep chunks <= 150 items (<= 300 ops)
  const chunkSize = 150;
  for (let i = 0; i < input.auditResults.length; i += chunkSize) {
    const chunk = input.auditResults.slice(i, i + chunkSize);
    const batch = writeBatch(db);
    let ops = 0;

    for (const res of chunk) {
      const sug = sugById.get(res.id);
      if (!sug || sug.status === 'approved' || sug.status === 'rejected') {
        continue;
      }

      const confidence = Math.min(100, Math.max(0, Math.round(res.confidence)));
      const reasoning = cleanStr(res.reasoning, SCHEMA_LIMITS.NOTE_MAX);

      if (res.verdict === 'auto_approve' && confidence >= 80) {
        const placeId = makeSafeId('place');
        const coords = cleanOptionalCoords(sug.lat, sug.lng);
        batch.set(doc(db, 'places', placeId), {
          id: placeId,
          name: cleanStr(sug.name, SCHEMA_LIMITS.NAME_MAX),
          category: sug.category,
          district: cleanStr(sug.district, SCHEMA_LIMITS.DISTRICT_MAX),
          landmarkHint: cleanStr(sug.landmarkHint ?? '', SCHEMA_LIMITS.LANDMARK_MAX),
          ...coords,
          sourceNote: cleanStr(
            sug.sourceReference ?? sug.fieldNotes ?? '',
            SCHEMA_LIMITS.NOTE_MAX
          ),
          sourceSuggestionId: sug.id,
          verifiedByUid: input.adminUid,
          verifiedAt: serverTimestamp(),
          isActive: true,
        });
        batch.update(doc(db, 'place_suggestions', sug.id), {
          status: 'approved',
          aiConfidence: confidence,
          aiVerdict: 'auto_approve',
          aiReasoning: reasoning,
          reviewNote: cleanStr(
            `اعتماد هجين تلقائي (${confidence}%): ${reasoning}`,
            SCHEMA_LIMITS.NOTE_MAX
          ),
          updatedAt: serverTimestamp(),
        });
        autoApproved += 1;
        ops += 2;
      } else if (res.verdict === 'field_check') {
        batch.update(doc(db, 'place_suggestions', sug.id), {
          status: 'field_check',
          aiConfidence: confidence,
          aiVerdict: 'field_check',
          aiReasoning: reasoning,
          reviewNote: cleanStr(
            `تحويل هجين للتحقق الميداني (${confidence}%): ${reasoning}`,
            SCHEMA_LIMITS.NOTE_MAX
          ),
          updatedAt: serverTimestamp(),
        });
        sentToFieldCheck += 1;
        ops += 1;
      } else {
        batch.update(doc(db, 'place_suggestions', sug.id), {
          status: 'pending',
          aiConfidence: confidence,
          aiVerdict: 'needs_review',
          aiReasoning: reasoning,
          updatedAt: serverTimestamp(),
        });
        needsReview += 1;
        ops += 1;
      }
    }

    if (ops > 0) {
      try {
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, 'place_suggestions');
      }
    }
  }

  await syncPublicStats();
  return {autoApproved, sentToFieldCheck, needsReview};
}

export async function approveAndPublishRouteSuggestion(input: {
  suggestion: RouteSuggestion;
  adminUid: string;
  stops: VerifiedPlace[];
  fareEgp: number;
  estimatedMinutes: number;
  vehicleType: VehicleType;
  notes?: string;
  reviewNote?: string;
}): Promise<string> {
  if (input.stops.length < 2) {
    throw new Error('يجب أن يحتوي الخط الموثق على نقطتين موثقتين على الأقل.');
  }
  const routeId = makeSafeId('route');
  const {name, direction} = generateRouteMeta(input.stops);
  const stopIds = input.stops.map((s) => s.id);
  const stopNames = input.stops.map((s) => cleanStr(s.name, SCHEMA_LIMITS.NAME_MAX));

  const batch = writeBatch(db);
  batch.set(doc(db, 'routes', routeId), {
    id: routeId,
    name,
    direction,
    originPlaceId: stopIds[0],
    destinationPlaceId: stopIds[stopIds.length - 1],
    stopIds,
    stopNames,
    fareEgp: Math.min(SCHEMA_LIMITS.FARE_MAX, Math.max(1, Number(input.fareEgp))),
    estimatedMinutes: Math.min(
      SCHEMA_LIMITS.MINUTES_MAX,
      Math.max(1, Math.round(input.estimatedMinutes))
    ),
    vehicleType: input.vehicleType,
    notes: cleanStr(input.notes ?? input.suggestion.notes ?? '', SCHEMA_LIMITS.NOTE_MAX),
    isActive: true,
    verifiedByUid: input.adminUid,
    publishedAt: serverTimestamp(),
  });

  batch.update(doc(db, 'route_suggestions', input.suggestion.id), {
    generatedName: name,
    generatedDirection: direction,
    stopIds,
    stopNames,
    fareEgp: Number(input.fareEgp),
    estimatedMinutes: Math.round(input.estimatedMinutes),
    vehicleType: input.vehicleType,
    status: 'approved',
    reviewNote: cleanStr(
      input.reviewNote || 'تم اعتماد الخط ونشره في البحث العام.',
      SCHEMA_LIMITS.NOTE_MAX
    ),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    await syncPublicStats();
    return routeId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `routes/${routeId}`);
  }
}

export async function updateRouteSuggestionAudit(input: {
  suggestionId: string;
  status: SuggestionStatus;
  aiConfidence: number;
  aiVerdict: AiVerdict;
  aiReasoning: string;
}): Promise<void> {
  const path = `route_suggestions/${input.suggestionId}`;
  try {
    await updateDoc(doc(db, 'route_suggestions', input.suggestionId), {
      status: input.status,
      aiConfidence: Math.min(100, Math.max(0, Math.round(input.aiConfidence))),
      aiVerdict: input.aiVerdict,
      aiReasoning: cleanStr(input.aiReasoning, SCHEMA_LIMITS.NOTE_MAX),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function rejectRouteSuggestion(
  suggestionId: string,
  reviewNote: string
): Promise<void> {
  const path = `route_suggestions/${suggestionId}`;
  try {
    await updateDoc(doc(db, 'route_suggestions', suggestionId), {
      status: 'rejected',
      reviewNote: cleanStr(reviewNote || 'لم يستوفِ شروط التوثيق.', SCHEMA_LIMITS.NOTE_MAX),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function publishDirectAdminRoute(input: {
  adminUid: string;
  stops: VerifiedPlace[];
  fareEgp: number;
  estimatedMinutes: number;
  vehicleType: VehicleType;
  notes?: string;
}): Promise<string> {
  if (input.stops.length < 2) {
    throw new Error('يجب اختيار نقطتين موثقتين على الأقل لإنشاء الخط.');
  }
  const routeId = makeSafeId('route');
  const path = `routes/${routeId}`;
  const {name, direction} = generateRouteMeta(input.stops);
  const stopIds = input.stops.map((s) => s.id);
  const stopNames = input.stops.map((s) => cleanStr(s.name, SCHEMA_LIMITS.NAME_MAX));

  try {
    await setDoc(doc(db, 'routes', routeId), {
      id: routeId,
      name,
      direction,
      originPlaceId: stopIds[0],
      destinationPlaceId: stopIds[stopIds.length - 1],
      stopIds,
      stopNames,
      fareEgp: Math.min(SCHEMA_LIMITS.FARE_MAX, Math.max(1, Number(input.fareEgp))),
      estimatedMinutes: Math.min(
        SCHEMA_LIMITS.MINUTES_MAX,
        Math.max(1, Math.round(input.estimatedMinutes))
      ),
      vehicleType: input.vehicleType,
      notes: cleanStr(input.notes ?? '', SCHEMA_LIMITS.NOTE_MAX),
      isActive: true,
      verifiedByUid: input.adminUid,
      publishedAt: serverTimestamp(),
    });
    await syncPublicStats();
    return routeId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateReportStatus(
  reportId: string,
  status: ReportStatus,
  reviewNote?: string
): Promise<void> {
  const path = `reports/${reportId}`;
  try {
    await updateDoc(doc(db, 'reports', reportId), {
      status,
      reviewNote: cleanStr(reviewNote ?? '', SCHEMA_LIMITS.NOTE_MAX),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function importSuggestionsBatch(input: {
  adminUid: string;
  items: SeedPlaceSuggestion[];
  replaceInitialSeeds: boolean;
}): Promise<number> {
  const path = 'place_suggestions';
  try {
    const batch = writeBatch(db);
    if (input.replaceInitialSeeds) {
      const existingSnap = await getDocs(collection(db, path));
      for (const docSnap of existingSnap.docs) {
        const data = docSnap.data();
        if (
          data.isInitialSeed === true &&
          (data.status === 'pending' || data.status === 'field_check')
        ) {
          batch.delete(docSnap.ref);
        }
      }
    }

    let count = 0;
    for (const raw of input.items) {
      const id =
        raw.id && SCHEMA_LIMITS.ID_PATTERN.test(raw.id)
          ? raw.id.slice(0, 128)
          : makeSafeId('imp');
      const coords = cleanOptionalCoords(raw.lat, raw.lng);
      const safeStatus: SuggestionStatus =
        raw.status === 'field_check' ? 'field_check' : 'pending';
      batch.set(doc(db, path, id), {
        id,
        name: cleanStr(raw.name || 'نقطة بدون اسم', SCHEMA_LIMITS.NAME_MAX),
        category: raw.category || 'pickup_point',
        district: cleanStr(raw.district || 'الإسكندرية', SCHEMA_LIMITS.DISTRICT_MAX),
        landmarkHint: cleanStr(raw.landmarkHint ?? '', SCHEMA_LIMITS.LANDMARK_MAX),
        ...coords,
        status: safeStatus,
        sourceReference: cleanStr(raw.sourceReference ?? '', SCHEMA_LIMITS.NOTE_MAX),
        fieldNotes: cleanStr(raw.fieldNotes ?? '', SCHEMA_LIMITS.NOTE_MAX),
        submittedByUid: input.adminUid,
        isInitialSeed: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      count += 1;
    }

    await batch.commit();
    await syncPublicStats();
    return count;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function addAdminMember(input: {
  uid: string;
  displayName: string;
  email: string;
  addedByUid: string;
}): Promise<void> {
  const cleanUid = input.uid.trim();
  if (!SCHEMA_LIMITS.ID_PATTERN.test(cleanUid)) {
    throw new Error('معرّف المستخدم (UID) غير صالح.');
  }
  const path = `admins/${cleanUid}`;
  try {
    await setDoc(doc(db, 'admins', cleanUid), {
      uid: cleanUid,
      displayName: cleanStr(input.displayName, SCHEMA_LIMITS.NAME_MAX),
      email: cleanStr(input.email, 180),
      addedByUid: input.addedByUid,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function removeAdminMember(uid: string): Promise<void> {
  const path = `admins/${uid}`;
  try {
    await deleteDoc(doc(db, 'admins', uid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function submitPlaceAndAutoPublishIfTrusted(input: {
  uid: string;
  isAdmin: boolean;
  name: string;
  category: PlaceCategory;
  district: string;
  landmarkHint?: string;
  sourceReference?: string;
  fieldNotes?: string;
  aiConfidence?: number;
  aiVerdict?: AiVerdict;
  aiReasoning?: string;
}): Promise<{suggestionId: string; autoPublishedPlaceId: string | null}> {
  const suggestionId = await submitPlaceSuggestion(input);
  if (
    input.isAdmin &&
    input.aiVerdict === 'auto_approve' &&
    typeof input.aiConfidence === 'number' &&
    input.aiConfidence >= 80
  ) {
    const placeId = makeSafeId('place');
    const name = cleanStr(input.name, SCHEMA_LIMITS.NAME_MAX);
    const district = cleanStr(input.district, SCHEMA_LIMITS.DISTRICT_MAX);
    const landmarkHint = cleanStr(
      input.landmarkHint ?? '',
      SCHEMA_LIMITS.LANDMARK_MAX
    );
    const sourceNote = cleanStr(
      input.sourceReference ?? input.fieldNotes ?? '',
      SCHEMA_LIMITS.NOTE_MAX
    );
    const reasoning = cleanStr(input.aiReasoning ?? '', SCHEMA_LIMITS.NOTE_MAX);
    const batch = writeBatch(db);
    batch.set(doc(db, 'places', placeId), {
      id: placeId,
      name,
      category: input.category,
      district,
      landmarkHint,
      sourceNote,
      sourceSuggestionId: suggestionId,
      verifiedByUid: input.uid,
      verifiedAt: serverTimestamp(),
      isActive: true,
    });
    batch.update(doc(db, 'place_suggestions', suggestionId), {
      status: 'approved',
      reviewNote: cleanStr(
        `اعتماد ذكي فوري (${input.aiConfidence}%): ${reasoning}`,
        SCHEMA_LIMITS.NOTE_MAX
      ),
      updatedAt: serverTimestamp(),
    });
    try {
      await batch.commit();
      await syncPublicStats();
      return {suggestionId, autoPublishedPlaceId: placeId};
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `places/${placeId}`);
    }
  }
  return {suggestionId, autoPublishedPlaceId: null};
}

export async function submitRouteAndAutoPublishIfTrusted(input: {
  uid: string;
  isAdmin: boolean;
  stops: VerifiedPlace[];
  fareEgp: number;
  estimatedMinutes: number;
  vehicleType: VehicleType;
  notes?: string;
  aiConfidence?: number;
  aiVerdict?: AiVerdict;
  aiReasoning?: string;
}): Promise<{suggestionId: string; autoPublishedRouteId: string | null}> {
  const suggestionId = await submitRouteSuggestion(input);
  if (
    input.isAdmin &&
    input.aiVerdict === 'auto_approve' &&
    typeof input.aiConfidence === 'number' &&
    input.aiConfidence >= 80 &&
    input.stops.length >= 2
  ) {
    const routeId = makeSafeId('route');
    const {name, direction} = generateRouteMeta(input.stops);
    const stopIds = input.stops.map((s) => s.id);
    const stopNames = input.stops.map((s) => cleanStr(s.name, SCHEMA_LIMITS.NAME_MAX));
    const reasoning = cleanStr(input.aiReasoning ?? '', SCHEMA_LIMITS.NOTE_MAX);
    const batch = writeBatch(db);
    batch.set(doc(db, 'routes', routeId), {
      id: routeId,
      name,
      direction,
      originPlaceId: stopIds[0],
      destinationPlaceId: stopIds[stopIds.length - 1],
      stopIds,
      stopNames,
      fareEgp: Math.min(SCHEMA_LIMITS.FARE_MAX, Math.max(1, Number(input.fareEgp))),
      estimatedMinutes: Math.min(
        SCHEMA_LIMITS.MINUTES_MAX,
        Math.max(1, Math.round(input.estimatedMinutes))
      ),
      vehicleType: input.vehicleType,
      notes: cleanStr(input.notes ?? '', SCHEMA_LIMITS.NOTE_MAX),
      isActive: true,
      verifiedByUid: input.uid,
      publishedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'route_suggestions', suggestionId), {
      status: 'approved',
      reviewNote: cleanStr(
        `اعتماد ذكي فوري (${input.aiConfidence}%): ${reasoning}`,
        SCHEMA_LIMITS.NOTE_MAX
      ),
      updatedAt: serverTimestamp(),
    });
    try {
      await batch.commit();
      await syncPublicStats();
      return {suggestionId, autoPublishedRouteId: routeId};
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `routes/${routeId}`);
    }
  }
  return {suggestionId, autoPublishedRouteId: null};
}

