import {useCallback, useEffect, useRef, useState} from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  AdminUser,
  AuditLogEntry,
  HybridAuditProgress,
  PlaceSuggestion,
  PublicStats,
  RouteSuggestion,
  TransitReport,
  TripOption,
  VerifiedPlace,
  VerifiedRoute,
} from './types/transit';
import {auth, googleProvider, testFirestoreConnection} from './lib/firebase';
import {
  applyHybridBatchAudit,
  checkUserAdminStatus,
  loadOfflineTransitCache,
  seedInitialSuggestionsIfNeeded,
  subscribeAdminsList,
  subscribePlaceSuggestions,
  subscribePublicStats,
  subscribeReports,
  subscribeRouteSuggestions,
  subscribeVerifiedPlaces,
  subscribeVerifiedRoutes,
} from './lib/firestoreService';
import {AiApiError, auditPlaceSuggestionsBatch} from './lib/aiApi';
import {TripSearchSection} from './components/TripSearchSection';
import {AiTripAssistant} from './components/AiTripAssistant';
import {ContributeSection} from './components/ContributeSection';
import {SourcesSection} from './components/SourcesSection';
import {TeamAdminModal} from './components/TeamAdminModal';
import {OfflineIndicator} from './components/OfflineIndicator';

type SectionId =
  | 'search-section'
  | 'ai-assistant-section'
  | 'contribute-section'
  | 'sources-section';

const WEBSITE_NAV_LINKS: Array<{id: SectionId; label: string}> = [
  {id: 'search-section', label: 'البحث والحاسبة'},
  {id: 'ai-assistant-section', label: 'المساعد الذكي'},
  {id: 'contribute-section', label: 'المساهمة'},
  {id: 'sources-section', label: 'المصادر'},
];

function isTeamRouteUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const search = new URLSearchParams(window.location.search);
  const hash = window.location.hash.toLowerCase();
  const path = window.location.pathname.toLowerCase();
  return (
    search.get('team') === '1' ||
    hash.includes('team') ||
    path === '/team' ||
    path === '/admin'
  );
}

function formatArabicTime(date: Date): string {
  return date.toLocaleTimeString('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export default function App() {
  const initialCache = loadOfflineTransitCache();

  const [authReady, setAuthReady] = useState(false);
  const [resolvedAuthUid, setResolvedAuthUid] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminCheckLoading, setAdminCheckLoading] = useState(false);
  const [teamModalOpen, setTeamModalOpen] = useState(() => isTeamRouteUrl());
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeSection, setActiveSection] =
    useState<SectionId>('search-section');

  // Verified public transit data
  const [verifiedPlaces, setVerifiedPlaces] = useState<VerifiedPlace[]>(
    () => initialCache?.places ?? []
  );
  const [verifiedRoutes, setVerifiedRoutes] = useState<VerifiedRoute[]>(
    () => initialCache?.routes ?? []
  );
  const [publicStats, setPublicStats] = useState<PublicStats | null>(
    () => initialCache?.stats ?? null
  );

  // Authenticated user / admin review queues
  const [placeSuggestions, setPlaceSuggestions] = useState<PlaceSuggestion[]>([]);
  const [routeSuggestions, setRouteSuggestions] = useState<RouteSuggestion[]>([]);
  const [reports, setReports] = useState<TransitReport[]>([]);
  const [adminsList, setAdminsList] = useState<AdminUser[]>([]);

  // Hybrid AI Audit Progress & Error Log
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [hybridProgress, setHybridProgress] =
    useState<HybridAuditProgress | null>(null);
  const auditRunningRef = useRef(false);
  const auditPausedRef = useRef(false);
  const autoAuditTriggeredForUidRef = useRef<string | null>(null);

  // Trip search state
  const [originId, setOriginId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [selectedTrip, setSelectedTrip] = useState<TripOption | null>(null);

  const addAuditLog = useCallback(
    (entry: Omit<AuditLogEntry, 'id' | 'timestamp'>) => {
      const next: AuditLogEntry = {
        ...entry,
        id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: formatArabicTime(new Date()),
      };
      setAuditLogs((prev) => [next, ...prev].slice(0, 60));
    },
    []
  );

  const clearAuditLogs = useCallback(() => {
    setAuditLogs([]);
  }, []);

  // Validate Firestore connection on boot
  useEffect(() => {
    void testFirestoreConnection();
  }, []);

  // Listen for private Team route (?team=1 or #/team)
  useEffect(() => {
    const syncRoute = () => {
      if (isTeamRouteUrl()) {
        setTeamModalOpen(true);
      }
    };
    window.addEventListener('hashchange', syncRoute);
    window.addEventListener('popstate', syncRoute);
    return () => {
      window.removeEventListener('hashchange', syncRoute);
      window.removeEventListener('popstate', syncRoute);
    };
  }, []);

  // Subscribe to public verified collections
  useEffect(() => {
    const unsubPlaces = subscribeVerifiedPlaces(setVerifiedPlaces);
    const unsubRoutes = subscribeVerifiedRoutes(setVerifiedRoutes);
    const unsubStats = subscribePublicStats(setPublicStats);
    return () => {
      unsubPlaces();
      unsubRoutes();
      unsubStats();
    };
  }, []);

  // Track Firebase Auth state & resolve admin role cleanly before attaching protected listeners
  useEffect(() => {
    let cancelled = false;
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        if (!cancelled) {
          setIsAdmin(false);
          setResolvedAuthUid(null);
          setPlaceSuggestions([]);
          setRouteSuggestions([]);
          setReports([]);
          setAdminsList([]);
          autoAuditTriggeredForUidRef.current = null;
          setAdminCheckLoading(false);
          setAuthReady(true);
        }
        return;
      }

      setAuthReady(false);
      setAdminCheckLoading(true);
      try {
        const adminStatus = await checkUserAdminStatus(
          nextUser.uid,
          nextUser.email,
          nextUser.emailVerified
        );
        if (cancelled) return;
        setIsAdmin(adminStatus);
        setResolvedAuthUid(nextUser.uid);
        if (adminStatus) {
          const seedRes = await seedInitialSuggestionsIfNeeded(
            nextUser.uid,
            false
          );
          if (!cancelled && seedRes.seeded && seedRes.count > 0) {
            addAuditLog({
              level: 'info',
              title: `تم تجهيز ${seedRes.count} مقترحًا أوليًا في قائمة التدقيق`,
            });
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Admin verification check failed:', err);
          setIsAdmin(false);
          setResolvedAuthUid(nextUser.uid);
        }
      } finally {
        if (!cancelled) {
          setAdminCheckLoading(false);
          setAuthReady(true);
        }
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [addAuditLog]);

  // Attach protected listeners only after auth & admin status resolve for the current user
  useEffect(() => {
    if (
      !authReady ||
      !user ||
      resolvedAuthUid !== user.uid ||
      !user.emailVerified
    ) {
      return;
    }
    const unsubPlaceSugs = subscribePlaceSuggestions(
      user.uid,
      isAdmin,
      setPlaceSuggestions
    );
    const unsubRouteSugs = subscribeRouteSuggestions(
      user.uid,
      isAdmin,
      setRouteSuggestions
    );
    const unsubReports = subscribeReports(user.uid, isAdmin, setReports);
    const unsubAdmins = isAdmin ? subscribeAdminsList(setAdminsList) : () => {};

    return () => {
      unsubPlaceSugs();
      unsubRouteSugs();
      unsubReports();
      unsubAdmins();
    };
  }, [authReady, user, resolvedAuthUid, isAdmin]);

  // Resilient Chunked Hybrid Auto-Audit Runner (10-item chunks, paced & saved per chunk)
  const runHybridPlacesAudit = useCallback(
    async (mode: 'unaudited' | 'all_pending' = 'unaudited') => {
      if (!user || !isAdmin || auditRunningRef.current) return;

      const candidates = placeSuggestions.filter((s) => {
        const eligibleStatus =
          s.status === 'pending' || s.status === 'field_check';
        if (!eligibleStatus) return false;
        return mode === 'unaudited' ? !s.aiVerdict : true;
      });

      if (candidates.length === 0) {
        addAuditLog({
          level: 'info',
          title: 'لا توجد مقترحات تحتاج إلى تدقيق ذكي حاليًا',
        });
        return;
      }

      auditRunningRef.current = true;
      auditPausedRef.current = false;

      const CHUNK_SIZE = 10;
      const totalChunks = Math.ceil(candidates.length / CHUNK_SIZE);
      let processed = 0;
      let autoApproved = 0;
      let sentToFieldCheck = 0;
      let needsReview = 0;
      let failedChunks = 0;

      setHybridProgress({
        running: true,
        processed: 0,
        total: candidates.length,
        autoApproved: 0,
        sentToFieldCheck: 0,
        needsReview: 0,
        failedChunks: 0,
      });

      addAuditLog({
        level: 'info',
        title: `بدء التدقيق والاعتماد الذكي (${candidates.length} مقترحًا في ${totalChunks} دفعات)`,
      });

      const knownNames = verifiedPlaces.map((p) => p.name);

      try {
        for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
          if (auditPausedRef.current) {
            addAuditLog({
              level: 'warning',
              title: `تم إيقاف التدقيق مؤقتًا عند ${processed} من ${candidates.length}`,
            });
            break;
          }

          if (chunkIdx > 0) {
            await new Promise((resolve) => setTimeout(resolve, 900));
            if (auditPausedRef.current) break;
          }

          const chunk = candidates.slice(
            chunkIdx * CHUNK_SIZE,
            (chunkIdx + 1) * CHUNK_SIZE
          );

          try {
            const auditRes = await auditPlaceSuggestionsBatch({
              items: chunk.map((c) => ({
                id: c.id,
                name: c.name,
                category: c.category,
                district: c.district,
                landmarkHint: c.landmarkHint,
                sourceReference: c.sourceReference,
                fieldNotes: c.fieldNotes,
              })),
              existingVerifiedNames: knownNames,
            });

            if (auditRes.results.length === 0) {
              failedChunks += 1;
              addAuditLog({
                level: 'warning',
                title: `الدفعة ${chunkIdx + 1}/${totalChunks} لم تُرجع نتائج مطابقة`,
                details: 'يمكنك الضغط على «إعادة محاولة المتبقي» لإعادة فحصها.',
              });
              break;
            }

            const outcome = await applyHybridBatchAudit({
              adminUid: user.uid,
              suggestions: chunk,
              auditResults: auditRes.results,
            });

            for (const r of auditRes.results) {
              if (r.verdict === 'auto_approve' && r.confidence >= 80) {
                const matched = chunk.find((c) => c.id === r.id);
                if (matched) knownNames.push(matched.name);
              }
            }

            processed += chunk.length;
            autoApproved += outcome.autoApproved;
            sentToFieldCheck += outcome.sentToFieldCheck;
            needsReview += outcome.needsReview;

            setHybridProgress({
              running: true,
              processed,
              total: candidates.length,
              autoApproved,
              sentToFieldCheck,
              needsReview,
              failedChunks,
            });

            addAuditLog({
              level: 'success',
              title: `الدفعة ${chunkIdx + 1}/${totalChunks} (${chunk.length} عناصر)`,
              details: `نُشر ${outcome.autoApproved} تلقائيًا · ${outcome.sentToFieldCheck} تحقق ميداني · ${outcome.needsReview} مراجعة${
                auditRes.latencyMs ? ` (${Math.round(auditRes.latencyMs / 100) / 10} ث)` : ''
              }`,
            });
          } catch (err) {
            failedChunks += 1;
            const isRateLimited =
              err instanceof AiApiError && err.code === 'AI_RATE_LIMITED';
            const errMsg =
              err instanceof Error
                ? err.message
                : 'حدث خطأ غير متوقع أثناء التدقيق الذكي.';
            addAuditLog({
              level: isRateLimited ? 'warning' : 'error',
              title: isRateLimited
                ? `توقف مؤقت بسبب حد الطلبات عند الدفعة ${chunkIdx + 1}/${totalChunks}`
                : `توقفت الدفعة ${chunkIdx + 1}/${totalChunks} بعد محاولات الإعادة`,
              details: `${errMsg} — تم حفظ كل الدفعات السابقة، استخدم «إعادة محاولة المتبقي» للاستكمال.`,
            });
            setHybridProgress({
              running: false,
              processed,
              total: candidates.length,
              autoApproved,
              sentToFieldCheck,
              needsReview,
              failedChunks,
            });
            break;
          }
        }
      } finally {
        auditRunningRef.current = false;
        setHybridProgress((prev) =>
          prev ? {...prev, running: false} : null
        );
      }
    },
    [user, isAdmin, placeSuggestions, verifiedPlaces, addAuditLog]
  );

  const handlePauseHybridAudit = useCallback(() => {
    auditPausedRef.current = true;
  }, []);

  // Automatically trigger chunked hybrid audit once per admin sign-in when un-audited items exist
  useEffect(() => {
    if (!authReady || !user || !isAdmin || resolvedAuthUid !== user.uid) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (autoAuditTriggeredForUidRef.current === user.uid) return;
    const hasUnaudited = placeSuggestions.some(
      (s) => (s.status === 'pending' || s.status === 'field_check') && !s.aiVerdict
    );
    if (!hasUnaudited) return;

    autoAuditTriggeredForUidRef.current = user.uid;
    void runHybridPlacesAudit('unaudited');
  }, [
    authReady,
    user,
    isAdmin,
    resolvedAuthUid,
    placeSuggestions,
    runHybridPlacesAudit,
  ]);

  const handleSignIn = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر تسجيل الدخول.';
      setAuthError(msg);
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    await signOut(auth);
  }, []);

  const scrollToSection = (id: SectionId) => {
    setActiveSection(id);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({behavior: 'smooth', block: 'start'});
    }
  };

  const handleCloseTeamModal = () => {
    setTeamModalOpen(false);
    if (typeof window !== 'undefined' && isTeamRouteUrl()) {
      window.history.replaceState(null, '', '/');
    }
  };

  const pendingTotalCount =
    (publicStats?.pendingSuggestionsCount ?? 56) +
    (publicStats?.fieldCheckCount ?? 4);

  return (
    <div dir="rtl" className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A]">
      {/* Standard Responsive Website Header */}
      <header className="bg-white/95 backdrop-blur-md border-b border-[#E2E8F0] sticky top-0 z-40">
        <div className="max-w-[1200px] mx-auto px-4 md:px-6 min-h-14 md:h-16 flex flex-wrap md:flex-nowrap items-center justify-between gap-3 md:gap-8 py-2 md:py-0">
          <a
            href="#search-section"
            onClick={(e) => {
              e.preventDefault();
              scrollToSection('search-section');
            }}
            className="text-xl font-extrabold tracking-tight text-[#0B4F6C] font-display whitespace-nowrap shrink-0"
          >
            مشروعي
          </a>

          <nav
            aria-label="التنقل الرئيسي"
            className="flex items-center gap-4 md:gap-6 text-xs md:text-sm font-medium text-[#475569] overflow-x-auto max-w-full"
          >
            {WEBSITE_NAV_LINKS.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  scrollToSection(item.id);
                }}
                className={`py-1.5 transition-colors whitespace-nowrap shrink-0 ${
                  activeSection === item.id
                    ? 'text-[#0B4F6C] font-bold'
                    : 'hover:text-[#0F172A]'
                }`}
              >
                {item.label}
              </a>
            ))}
          </nav>

          <p className="hidden lg:block text-xs text-[#64748B] whitespace-nowrap shrink-0">
            دليل مواصلات الإسكندرية
          </p>
        </div>
      </header>

      <main className="flex-1 max-w-[1200px] w-full mx-auto px-4 md:px-6 py-6 md:py-8 space-y-8 md:space-y-10">
        <OfflineIndicator cachedPlacesCount={verifiedPlaces.length} />

        {authError && (
          <div className="p-3 rounded-lg bg-[#DC2626]/5 border border-[#DC2626]/30 text-xs text-[#991B1B]">
            {authError}
          </div>
        )}

        <TripSearchSection
          places={verifiedPlaces}
          routes={verifiedRoutes}
          publicStats={publicStats}
          originId={originId}
          destinationId={destinationId}
          onChangeOrigin={setOriginId}
          onChangeDestination={setDestinationId}
          selectedTrip={selectedTrip}
          onSelectTrip={setSelectedTrip}
          onNavigateContribute={() => scrollToSection('contribute-section')}
          onNavigateAiAssistant={() => scrollToSection('ai-assistant-section')}
        />

        <AiTripAssistant
          places={verifiedPlaces}
          routes={verifiedRoutes}
          pendingTotalCount={pendingTotalCount}
          onApplyMatchedRoute={(nextOriginId, nextDestId) => {
            if (nextOriginId) setOriginId(nextOriginId);
            if (nextDestId) setDestinationId(nextDestId);
            setSelectedTrip(null);
            scrollToSection('search-section');
          }}
        />

        <ContributeSection
          user={user}
          isAdmin={isAdmin}
          onSignIn={handleSignIn}
          verifiedPlaces={verifiedPlaces}
          verifiedRoutes={verifiedRoutes}
          myPlaceSuggestions={placeSuggestions}
          myRouteSuggestions={routeSuggestions}
          myReports={reports}
          onRecordAuditLog={addAuditLog}
        />

        <SourcesSection
          publicStats={publicStats}
          verifiedPlacesCount={verifiedPlaces.length}
          publishedRoutesCount={verifiedRoutes.length}
        />
      </main>

      <footer className="border-t border-[#E2E8F0] bg-white">
        <div className="max-w-[1200px] mx-auto px-4 md:px-6 py-5 flex flex-wrap items-center justify-between gap-4 text-xs text-[#475569]">
          <p>مشروعي — موقع دليل مواصلات الإسكندرية الموثق</p>
          <div className="flex flex-wrap items-center gap-4">
            <p>مساعد رحلات ذكي · اعتماد هجين تلقائي · متجاوب مع الكمبيوتر والهاتف</p>
            <button
              type="button"
              onClick={() => setTeamModalOpen(true)}
              className="text-[11px] text-[#64748B] hover:text-[#0F172A] transition-colors cursor-pointer whitespace-nowrap"
            >
              إدارة الفريق
            </button>
          </div>
        </div>
      </footer>

      <TeamAdminModal
        open={teamModalOpen}
        onClose={handleCloseTeamModal}
        user={user}
        isAdmin={isAdmin}
        adminCheckLoading={adminCheckLoading}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        verifiedPlaces={verifiedPlaces}
        placeSuggestions={placeSuggestions}
        routeSuggestions={routeSuggestions}
        reports={reports}
        adminsList={adminsList}
        auditLogs={auditLogs}
        onAddAuditLog={addAuditLog}
        onClearAuditLogs={clearAuditLogs}
        hybridProgress={hybridProgress}
        onRunHybridPlacesAudit={runHybridPlacesAudit}
        onPauseHybridAudit={handlePauseHybridAudit}
      />
    </div>
  );
}
