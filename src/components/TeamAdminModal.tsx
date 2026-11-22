import React, {useMemo, useState} from 'react';
import {User} from 'firebase/auth';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Database,
  Download,
  FileUp,
  History,
  Info,
  LogIn,
  LogOut,
  PauseCircle,
  Plus,
  RefreshCw,
  Shield,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  INITIAL_60_SUGGESTIONS,
  SeedPlaceSuggestion,
} from '../data/initialSuggestions';
import {
  AI_VERDICT_LABELS,
  AdminUser,
  AuditLogEntry,
  HybridAuditProgress,
  PLACE_CATEGORY_LABELS,
  PlaceCategory,
  PlaceSuggestion,
  REPORT_STATUS_LABELS,
  REPORT_TYPE_LABELS,
  ReportStatus,
  RouteSuggestion,
  SCHEMA_LIMITS,
  SUGGESTION_STATUS_LABELS,
  SuggestionStatus,
  TransitReport,
  VEHICLE_TYPE_LABELS,
  VehicleType,
  VerifiedPlace,
} from '../types/transit';
import {
  addAdminMember,
  approveAndPublishPlaceSuggestion,
  approveAndPublishRouteSuggestion,
  importSuggestionsBatch,
  publishDirectAdminRoute,
  rejectRouteSuggestion,
  removeAdminMember,
  seedInitialSuggestionsIfNeeded,
  updatePlaceSuggestionReview,
  updateReportStatus,
  updateRouteSuggestionAudit,
} from '../lib/firestoreService';
import {evaluateSuggestionWithAi} from '../lib/aiApi';
import {RouteBuilderControl} from './RouteBuilderControl';

interface TeamAdminModalProps {
  open: boolean;
  onClose: () => void;
  user: User | null;
  isAdmin: boolean;
  adminCheckLoading: boolean;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  verifiedPlaces: VerifiedPlace[];
  placeSuggestions: PlaceSuggestion[];
  routeSuggestions: RouteSuggestion[];
  reports: TransitReport[];
  adminsList: AdminUser[];
  auditLogs: AuditLogEntry[];
  onAddAuditLog: (entry: Omit<AuditLogEntry, 'id' | 'timestamp'>) => void;
  onClearAuditLogs: () => void;
  hybridProgress: HybridAuditProgress | null;
  onRunHybridPlacesAudit: (mode: 'unaudited' | 'all_pending') => Promise<void>;
  onPauseHybridAudit: () => void;
}

function parseImportText(raw: string): SeedPlaceSuggestion[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map((item, idx) => ({
      id: typeof item.id === 'string' && item.id ? item.id : `imp-${Date.now()}-${idx}`,
      name: String(item.name ?? ''),
      category: (['neighborhood', 'pickup_point', 'market', 'historical_stand'].includes(
        item.category
      )
        ? item.category
        : 'pickup_point') as PlaceCategory,
      district: String(item.district ?? 'شرق الإسكندرية'),
      landmarkHint: String(item.landmarkHint ?? ''),
      lat: typeof item.lat === 'number' ? Number(item.lat) : undefined,
      lng: typeof item.lng === 'number' ? Number(item.lng) : undefined,
      status: item.status === 'field_check' ? 'field_check' : 'pending',
      sourceReference: String(item.sourceReference ?? ''),
      fieldNotes: String(item.fieldNotes ?? ''),
    }));
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const rows = lines[0]?.toLowerCase().includes('name') ? lines.slice(1) : lines;

  return rows.map((line, idx) => {
    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const cat = cols[1];
    const st = cols[4];
    return {
      id: `imp-${Date.now()}-${idx}`,
      name: cols[0] || `نقطة ${idx + 1}`,
      category: (['neighborhood', 'pickup_point', 'market', 'historical_stand'].includes(cat)
        ? cat
        : 'pickup_point') as PlaceCategory,
      district: cols[2] || 'شرق الإسكندرية',
      landmarkHint: cols[3] || '',
      status: st === 'field_check' ? 'field_check' : 'pending',
      sourceReference: cols[5] || '',
      fieldNotes: cols[6] || '',
    };
  });
}

const LOG_LEVEL_LABELS: Record<AuditLogEntry['level'], string> = {
  success: 'تم',
  warning: 'تنبيه',
  error: 'خطأ',
  info: 'معلومة',
};

export const TeamAdminModal: React.FC<TeamAdminModalProps> = ({
  open,
  onClose,
  user,
  isAdmin,
  adminCheckLoading,
  onSignIn,
  onSignOut,
  verifiedPlaces,
  placeSuggestions,
  routeSuggestions,
  reports,
  adminsList,
  auditLogs,
  onAddAuditLog,
  onClearAuditLogs,
  hybridProgress,
  onRunHybridPlacesAudit,
  onPauseHybridAudit,
}) => {
  const [tab, setTab] = useState<'places' | 'routes' | 'reports' | 'import'>(
    'places'
  );
  const [statusFilter, setStatusFilter] = useState<'all' | SuggestionStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | PlaceCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingPlace, setEditingPlace] = useState<PlaceSuggestion | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [routeHybridBusy, setRouteHybridBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showLogPanel, setShowLogPanel] = useState(true);

  // Direct Admin Route Builder
  const [directStops, setDirectStops] = useState<VerifiedPlace[]>([]);
  const [directFare, setDirectFare] = useState<number>(8);
  const [directMinutes, setDirectMinutes] = useState<number>(25);
  const [directVehicle, setDirectVehicle] = useState<VehicleType>('microbus');
  const [directNotes, setDirectNotes] = useState('');

  // Bulk Import State
  const [importText, setImportText] = useState('');
  const [replaceInitial, setReplaceInitial] = useState(true);

  // Add Admin Member State
  const [newAdminUid, setNewAdminUid] = useState('');
  const [newAdminName, setNewAdminName] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');

  const filteredPlaceSuggestions = useMemo(() => {
    const q = searchQuery.trim();
    return placeSuggestions.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (
        q &&
        !item.name.includes(q) &&
        !item.district.includes(q) &&
        !(item.landmarkHint ?? '').includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [placeSuggestions, statusFilter, categoryFilter, searchQuery]);

  const suggestionStats = useMemo(() => {
    let pending = 0;
    let fieldCheck = 0;
    let approved = 0;
    let rejected = 0;
    let unaudited = 0;
    for (const s of placeSuggestions) {
      if (s.status === 'pending') pending += 1;
      else if (s.status === 'field_check') fieldCheck += 1;
      else if (s.status === 'approved') approved += 1;
      else if (s.status === 'rejected') rejected += 1;
      if ((s.status === 'pending' || s.status === 'field_check') && !s.aiVerdict) {
        unaudited += 1;
      }
    }
    return {
      pending,
      fieldCheck,
      approved,
      rejected,
      unaudited,
      total: placeSuggestions.length,
    };
  }, [placeSuggestions]);

  const errorLogCount = useMemo(
    () => auditLogs.filter((l) => l.level === 'error').length,
    [auditLogs]
  );

  if (!open) return null;

  const hybridRunning = Boolean(hybridProgress?.running);

  const handleSeed60 = async () => {
    if (!user) return;
    setActionBusy(true);
    setToast(null);
    try {
      const res = await seedInitialSuggestionsIfNeeded(user.uid, true);
      const msg =
        res.count > 0
          ? `تمت إضافة ${res.count} مقترحًا أوليًا لتكتمل قائمة الـ 60 مكانًا وموقفًا.`
          : 'جميع الـ 60 مقترحًا الأولية موجودة بالفعل في قاعدة البيانات.';
      setToast(msg);
      onAddAuditLog({level: 'info', title: 'مزامنة القائمة الأولية', details: msg});
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'تعذر مزامنة القائمة الأولية.';
      setToast(msg);
      onAddAuditLog({
        level: 'error',
        title: 'فشل مزامنة القائمة الأولية',
        details: msg,
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleHybridRoutesAudit = async () => {
    if (!user) return;
    const candidates = routeSuggestions.filter(
      (r) => r.status === 'pending' || r.status === 'field_check'
    );
    if (candidates.length === 0) {
      setToast('لا توجد مقترحات خطوط منتظرة للتدقيق الهجين.');
      return;
    }

    setRouteHybridBusy(true);
    setToast(null);
    onAddAuditLog({
      level: 'info',
      title: `بدء التدقيق الذكي للخطوط (${candidates.length})`,
    });

    const placeMap: Record<string, VerifiedPlace> = {};
    for (const p of verifiedPlaces) placeMap[p.id] = p;

    let autoApproved = 0;
    let fieldChecked = 0;
    let needsReview = 0;
    let failed = 0;

    for (const rs of candidates) {
      try {
        const evalRes = await evaluateSuggestionWithAi({
          kind: 'route',
          item: {
            generatedName: rs.generatedName,
            generatedDirection: rs.generatedDirection,
            stopNames: rs.stopNames,
            fareEgp: rs.fareEgp,
            estimatedMinutes: rs.estimatedMinutes,
            vehicleType: rs.vehicleType,
            notes: rs.notes,
          },
          existingNames: [],
        });

        const resolvedStops = rs.stopIds
          .map((id) => placeMap[id])
          .filter((p): p is VerifiedPlace => Boolean(p));

        if (
          evalRes.verdict === 'auto_approve' &&
          evalRes.confidence >= 80 &&
          resolvedStops.length >= 2
        ) {
          await approveAndPublishRouteSuggestion({
            suggestion: rs,
            adminUid: user.uid,
            stops: resolvedStops,
            fareEgp: rs.fareEgp,
            estimatedMinutes: rs.estimatedMinutes,
            vehicleType: rs.vehicleType,
            reviewNote: `اعتماد هجين تلقائي (${evalRes.confidence}%): ${evalRes.reasoning}`,
          });
          autoApproved += 1;
          onAddAuditLog({
            level: 'success',
            title: `اعتماد ونشر خط «${rs.generatedName}»`,
            details: `ثقة ${evalRes.confidence}% · ${evalRes.reasoning}`,
          });
        } else if (evalRes.verdict === 'field_check') {
          await updateRouteSuggestionAudit({
            suggestionId: rs.id,
            status: 'field_check',
            aiConfidence: evalRes.confidence,
            aiVerdict: evalRes.verdict,
            aiReasoning: evalRes.reasoning,
          });
          fieldChecked += 1;
          onAddAuditLog({
            level: 'warning',
            title: `تحويل الخط «${rs.generatedName}» للتحقق الميداني`,
            details: `ثقة ${evalRes.confidence}% · ${evalRes.reasoning}`,
          });
        } else {
          await updateRouteSuggestionAudit({
            suggestionId: rs.id,
            status: 'pending',
            aiConfidence: evalRes.confidence,
            aiVerdict: evalRes.verdict,
            aiReasoning: evalRes.reasoning,
          });
          needsReview += 1;
        }
      } catch (err) {
        failed += 1;
        const msg =
          err instanceof Error
            ? err.message
            : 'تعذر تقييم الخط عبر خدمة الذكاء الاصطناعي.';
        onAddAuditLog({
          level: 'error',
          title: `خطأ تدقيق الخط «${rs.generatedName}»`,
          details: msg,
        });
      }
    }

    setRouteHybridBusy(false);
    setToast(
      `تدقيق الخطوط: نُشر ${autoApproved} تلقائيًا، حُوّل ${fieldChecked} للميدان، أُبقي ${needsReview} للمراجعة${failed > 0 ? `، وتعذر ${failed}` : ''}.`
    );
  };

  const handlePlaceStatusChange = async (
    item: PlaceSuggestion,
    nextStatus: SuggestionStatus
  ) => {
    if (!user) return;
    setActionBusy(true);
    setToast(null);
    try {
      if (nextStatus === 'approved') {
        await approveAndPublishPlaceSuggestion({
          suggestion: item,
          adminUid: user.uid,
          editedName: editingPlace?.id === item.id ? editingPlace.name : item.name,
          editedCategory:
            editingPlace?.id === item.id ? editingPlace.category : item.category,
          editedDistrict:
            editingPlace?.id === item.id ? editingPlace.district : item.district,
          editedLandmarkHint:
            editingPlace?.id === item.id
              ? editingPlace.landmarkHint
              : item.landmarkHint,
          reviewNote:
            editingPlace?.id === item.id ? editingPlace.reviewNote : item.reviewNote,
        });
        setToast(`تم اعتماد «${item.name}» ونشره ضمن الأماكن الموثقة.`);
      } else {
        await updatePlaceSuggestionReview({
          suggestionId: item.id,
          name: editingPlace?.id === item.id ? editingPlace.name : item.name,
          category:
            editingPlace?.id === item.id ? editingPlace.category : item.category,
          district:
            editingPlace?.id === item.id ? editingPlace.district : item.district,
          landmarkHint:
            editingPlace?.id === item.id
              ? editingPlace.landmarkHint
              : item.landmarkHint,
          status: nextStatus,
          sourceReference:
            editingPlace?.id === item.id
              ? editingPlace.sourceReference
              : item.sourceReference,
          fieldNotes:
            editingPlace?.id === item.id ? editingPlace.fieldNotes : item.fieldNotes,
          reviewNote:
            editingPlace?.id === item.id ? editingPlace.reviewNote : item.reviewNote,
        });
        setToast(
          `تم تحديث حالة «${item.name}» إلى ${SUGGESTION_STATUS_LABELS[nextStatus]}.`
        );
      }
      setEditingPlace(null);
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'تعذر تنفيذ إجراء المراجعة.');
    } finally {
      setActionBusy(false);
    }
  };

  const handlePublishDirectRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || directStops.length < 2) return;
    setActionBusy(true);
    setToast(null);
    try {
      await publishDirectAdminRoute({
        adminUid: user.uid,
        stops: directStops,
        fareEgp: directFare,
        estimatedMinutes: directMinutes,
        vehicleType: directVehicle,
        notes: directNotes,
      });
      setDirectStops([]);
      setDirectNotes('');
      setToast('تم نشر الخط الموثق بنجاح في البحث العام.');
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'تعذر نشر الخط.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleApproveRouteSuggestion = async (item: RouteSuggestion) => {
    if (!user) return;
    const placeMap: Record<string, VerifiedPlace> = {};
    for (const p of verifiedPlaces) placeMap[p.id] = p;
    const resolvedStops = item.stopIds
      .map((id) => placeMap[id])
      .filter((p): p is VerifiedPlace => Boolean(p));

    if (resolvedStops.length < 2) {
      setToast('تعذر اعتماد الخط لأن بعض محطاته لم تعد ضمن الأماكن الموثقة.');
      return;
    }

    setActionBusy(true);
    try {
      await approveAndPublishRouteSuggestion({
        suggestion: item,
        adminUid: user.uid,
        stops: resolvedStops,
        fareEgp: item.fareEgp,
        estimatedMinutes: item.estimatedMinutes,
        vehicleType: item.vehicleType,
      });
      setToast(`تم اعتماد ونشر «${item.generatedName}».`);
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'تعذر اعتماد الخط.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleImportSubmit = async () => {
    if (!user) return;
    setActionBusy(true);
    setToast(null);
    try {
      const items = parseImportText(importText);
      if (items.length === 0) {
        setToast('لم يتم العثور على عناصر صالحة للاستيراد.');
        setActionBusy(false);
        return;
      }
      const importedCount = await importSuggestionsBatch({
        adminUid: user.uid,
        items,
        replaceInitialSeeds: replaceInitial,
      });
      setImportText('');
      setToast(
        `تم استيراد ${importedCount} مقترحًا بحالة انتظار التدقيق أو التحقق الميداني.`
      );
    } catch (err) {
      setToast(
        err instanceof Error
          ? err.message
          : 'صيغة JSON أو CSV غير صالحة للاستيراد.'
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleExportJson = () => {
    const dataStr = JSON.stringify(
      placeSuggestions.length > 0 ? placeSuggestions : INITIAL_60_SUGGESTIONS,
      null,
      2
    );
    const blob = new Blob([dataStr], {type: 'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'alexandria-place-suggestions-60.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImportText(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setActionBusy(true);
    try {
      await addAdminMember({
        uid: newAdminUid,
        displayName: newAdminName,
        email: newAdminEmail,
        addedByUid: user.uid,
      });
      setNewAdminUid('');
      setNewAdminName('');
      setNewAdminEmail('');
      setToast('تمت إضافة المشرف الجديد إلى قائمة الفريق.');
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'تعذر إضافة المشرف.');
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0F172A]/60 backdrop-blur-[2px] flex items-center justify-center p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="إدارة الفريق والتدقيق الهجين"
    >
      <div className="bg-white border border-[#E2E8F0] rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-[#E2E8F0] flex items-center justify-between gap-3 bg-[#F8FAFC]">
          <div className="flex items-center gap-2.5 min-w-0">
            <Shield className="w-5 h-5 text-[#0B4F6C] shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-[#0F172A] truncate">
                بوابة الفريق والاعتماد الذكي التلقائي
              </h2>
              <p className="text-[11px] sm:text-xs text-[#475569] truncate">
                اعتماد فوري بدفعات سريعة · سجل التدقيق والأخطاء · التحقق الميداني
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-[#475569] hover:text-[#0F172A] hover:bg-[#E2E8F0]/50 cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {!user ? (
            <div className="max-w-lg mx-auto py-8 text-center space-y-4">
              <Shield className="w-10 h-10 text-[#0B4F6C] mx-auto" />
              <h3 className="text-lg font-bold text-[#0F172A]">
                تسجيل دخول فريق المراجعة (مسار خاص)
              </h3>
              <p className="text-sm text-[#475569] leading-relaxed">
                اضغط للدخول بحساب Google المصرح له بالإدارة لبدء التقييم والاعتماد الذكي التلقائي ومتابعة سجل التدقيق والأخطاء.
              </p>
              <button
                type="button"
                onClick={() => void onSignIn()}
                className="min-h-[44px] px-5 py-2.5 text-sm font-semibold text-white bg-[#0B4F6C] hover:bg-[#083B52] rounded-lg transition-colors inline-flex items-center gap-2 cursor-pointer"
              >
                <LogIn className="w-4 h-4" />
                الدخول بحساب Google
              </button>
            </div>
          ) : adminCheckLoading ? (
            <div className="py-12 text-center text-sm text-[#475569]">
              جارٍ التحقق من صلاحيات الإشراف...
            </div>
          ) : !isAdmin ? (
            <div className="max-w-lg mx-auto py-8 space-y-4 text-right bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-6">
              <h3 className="text-base font-bold text-[#0F172A]">
                الحساب الحالي مسجّل بصفة مساهم وليس مشرفًا
              </h3>
              <p className="text-sm text-[#475569] leading-relaxed">
                البريد المسجّل حاليًا:{' '}
                <span className="font-mono-num font-semibold text-[#0F172A]">
                  {user.email}
                </span>
              </p>
              <p className="text-xs text-[#64748B] font-mono-num break-all">
                UID: {user.uid}
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => void onSignOut().then(() => onSignIn())}
                  className="min-h-[44px] px-4 py-2 text-xs font-semibold text-white bg-[#0B4F6C] hover:bg-[#083B52] rounded-lg cursor-pointer"
                >
                  تبديل حساب Google
                </button>
                <button
                  type="button"
                  onClick={() => void onSignOut()}
                  className="min-h-[44px] px-4 py-2 text-xs font-semibold text-[#475569] bg-white border border-[#E2E8F0] hover:text-[#0F172A] rounded-lg cursor-pointer inline-flex items-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  تسجيل الخروج
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Admin Identity + Quick Actions */}
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#E2E8F0]">
                <div className="text-xs text-[#475569] leading-relaxed">
                  <span className="font-bold text-[#0F172A]">
                    {user.displayName || user.email}
                  </span>
                  <span className="mx-1.5" aria-hidden="true">·</span>
                  <span>مشرف معتمد</span>
                  <span className="mx-1.5" aria-hidden="true">·</span>
                  <span className="font-mono-num tabular-nums">
                    {suggestionStats.pending} انتظار · {suggestionStats.fieldCheck} تحقق ميداني ·{' '}
                    {suggestionStats.approved} معتمد
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSeed60()}
                    disabled={actionBusy || hybridRunning}
                    className="min-h-[40px] px-3 py-1.5 text-xs font-semibold text-[#0B4F6C] bg-[#0B4F6C]/10 hover:bg-[#0B4F6C]/20 rounded-lg cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    مزامنة الـ 60 مقترحًا
                  </button>
                  <button
                    type="button"
                    onClick={() => void onSignOut()}
                    className="min-h-[40px] px-3 py-1.5 text-xs font-semibold text-[#475569] bg-white border border-[#E2E8F0] hover:text-[#0F172A] rounded-lg cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    خروج
                  </button>
                </div>
              </div>

              {toast && (
                <div className="p-3 rounded-lg bg-[#0B4F6C]/5 border border-[#0B4F6C]/20 text-xs font-medium text-[#0B4F6C] flex items-center justify-between gap-2">
                  <span>{toast}</span>
                  <button
                    type="button"
                    onClick={() => setToast(null)}
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center text-[#475569] hover:text-[#0F172A] cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Admin Tabs */}
              <div className="flex items-center gap-1 p-1 bg-[#F1F5F9] rounded-lg overflow-x-auto max-w-full">
                <button
                  type="button"
                  onClick={() => setTab('places')}
                  className={`min-h-[40px] px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap shrink-0 ${
                    tab === 'places'
                      ? 'bg-white text-[#0F172A] shadow-sm'
                      : 'text-[#475569]'
                  }`}
                >
                  الأماكن والتدقيق ({placeSuggestions.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTab('routes')}
                  className={`min-h-[40px] px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap shrink-0 ${
                    tab === 'routes'
                      ? 'bg-white text-[#0F172A] shadow-sm'
                      : 'text-[#475569]'
                  }`}
                >
                  الخطوط ({routeSuggestions.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTab('reports')}
                  className={`min-h-[40px] px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap shrink-0 ${
                    tab === 'reports'
                      ? 'bg-white text-[#0F172A] shadow-sm'
                      : 'text-[#475569]'
                  }`}
                >
                  البلاغات ({reports.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTab('import')}
                  className={`min-h-[40px] px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap shrink-0 ${
                    tab === 'import'
                      ? 'bg-white text-[#0F172A] shadow-sm'
                      : 'text-[#475569]'
                  }`}
                >
                  الاستيراد والفريق
                </button>
              </div>

              {/* TAB 1: Place Suggestions + Chunked Auto-Hybrid Auditor + Audit & Error Log */}
              {tab === 'places' && (
                <div className="space-y-4">
                  {/* Hybrid Auto-Approval Control Bar */}
                  <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="space-y-1 max-w-xl">
                        <p className="text-xs font-bold text-[#0F172A] flex items-center gap-1.5">
                          <Sparkles className="w-4 h-4 text-[#0B4F6C]" />
                          الاعتماد الذكي التلقائي (دفعات من 10 عناصر مع حفظ فوري)
                        </p>
                        <p className="text-xs text-[#475569] leading-relaxed">
                          تُقيَّم المقترحات وتُنشر النقاط الموثوقة (80%+) تلقائيًا بدفعات صغيرة تُحفظ فورًا في قاعدة البيانات لتفادي تعليق الطلبات الطويلة.
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {hybridRunning ? (
                          <button
                            type="button"
                            onClick={onPauseHybridAudit}
                            className="min-h-[44px] px-4 py-2 text-xs font-semibold text-[#92400E] bg-[#D97706]/15 hover:bg-[#D97706]/25 rounded-lg cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap"
                          >
                            <PauseCircle className="w-4 h-4" />
                            إيقاف مؤقت
                          </button>
                        ) : (
                          <>
                            {suggestionStats.unaudited > 0 && (
                              <button
                                type="button"
                                disabled={actionBusy}
                                onClick={() => void onRunHybridPlacesAudit('unaudited')}
                                className="min-h-[44px] px-4 py-2 text-xs font-semibold text-white bg-[#0B4F6C] hover:bg-[#083B52] rounded-lg cursor-pointer disabled:opacity-50 inline-flex items-center gap-2 whitespace-nowrap"
                              >
                                <Sparkles className="w-4 h-4" />
                                تدقيق ونشر المتبقي تلقائيًا ({suggestionStats.unaudited})
                              </button>
                            )}
                            {suggestionStats.pending + suggestionStats.fieldCheck > 0 && (
                              <button
                                type="button"
                                disabled={actionBusy}
                                onClick={() => void onRunHybridPlacesAudit('all_pending')}
                                className="min-h-[44px] px-3.5 py-2 text-xs font-semibold text-[#0B4F6C] bg-white border border-[#E2E8F0] hover:bg-[#F1F5F9] rounded-lg cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                                إعادة فحص الانتظار ({suggestionStats.pending + suggestionStats.fieldCheck})
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {hybridProgress && hybridProgress.total > 0 && (
                      <div className="space-y-1.5 pt-2 border-t border-[#E2E8F0]">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono-num tabular-nums">
                          <span className="font-semibold text-[#0F172A]">
                            {hybridProgress.running ? 'جارٍ التشغيل التلقائي:' : 'آخر دورة تدقيق:'}{' '}
                            {hybridProgress.processed} / {hybridProgress.total}
                          </span>
                          <span className="text-[#475569]">
                            نُشر {hybridProgress.autoApproved} · ميداني {hybridProgress.sentToFieldCheck} · مراجعة {hybridProgress.needsReview}
                            {hybridProgress.failedChunks > 0
                              ? ` · دفعات متعثرة ${hybridProgress.failedChunks}`
                              : ''}
                          </span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-[#E2E8F0] overflow-hidden">
                          <div
                            className="h-full bg-[#0B4F6C] transition-all duration-300"
                            style={{
                              width: `${Math.min(
                                100,
                                Math.round(
                                  (hybridProgress.processed / hybridProgress.total) * 100
                                )
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Audit & Error Log Panel */}
                  <div className="rounded-xl border border-[#E2E8F0] bg-white overflow-hidden">
                    <div className="px-4 py-3 bg-[#F8FAFC] border-b border-[#E2E8F0] flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setShowLogPanel((prev) => !prev)}
                        className="text-xs font-bold text-[#0F172A] inline-flex items-center gap-2 cursor-pointer"
                      >
                        <History className="w-4 h-4 text-[#0B4F6C]" />
                        سجل التدقيق والأخطاء ({auditLogs.length})
                        {errorLogCount > 0 && (
                          <span className="text-[#DC2626] font-mono-num tabular-nums">
                            · {errorLogCount} خطأ
                          </span>
                        )}
                      </button>

                      <div className="flex items-center gap-2">
                        {(errorLogCount > 0 || suggestionStats.unaudited > 0) &&
                          !hybridRunning && (
                            <button
                              type="button"
                              onClick={() =>
                                void onRunHybridPlacesAudit(
                                  suggestionStats.unaudited > 0
                                    ? 'unaudited'
                                    : 'all_pending'
                                )
                              }
                              className="min-h-[36px] px-2.5 py-1 text-xs font-semibold text-[#0B4F6C] bg-[#0B4F6C]/10 hover:bg-[#0B4F6C]/20 rounded-md inline-flex items-center gap-1 cursor-pointer"
                            >
                              <RefreshCw className="w-3 h-3" />
                              إعادة محاولة المتبقي
                            </button>
                          )}
                        {auditLogs.length > 0 && (
                          <button
                            type="button"
                            onClick={onClearAuditLogs}
                            className="min-h-[36px] px-2 text-xs text-[#64748B] hover:text-[#0F172A] cursor-pointer"
                          >
                            مسح السجل
                          </button>
                        )}
                      </div>
                    </div>

                    {showLogPanel && (
                      <div className="max-h-56 overflow-y-auto divide-y divide-[#E2E8F0]">
                        {auditLogs.length === 0 ? (
                          <p className="p-4 text-xs text-[#64748B]">
                            لا توجد أحداث مسجّلة بعد. ستظهر هنا نتائج كل دفعة تدقيق وأي أخطاء تقنية أو شبكة بوضوح.
                          </p>
                        ) : (
                          auditLogs.map((entry) => (
                            <div
                              key={entry.id}
                              className="px-4 py-2.5 text-xs flex items-start justify-between gap-3"
                            >
                              <div className="flex items-start gap-2 min-w-0">
                                {entry.level === 'success' ? (
                                  <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />
                                ) : entry.level === 'error' ? (
                                  <AlertCircle className="w-4 h-4 text-[#DC2626] shrink-0 mt-0.5" />
                                ) : entry.level === 'warning' ? (
                                  <AlertCircle className="w-4 h-4 text-[#D97706] shrink-0 mt-0.5" />
                                ) : (
                                  <Info className="w-4 h-4 text-[#0B4F6C] shrink-0 mt-0.5" />
                                )}
                                <div className="min-w-0">
                                  <p className="font-semibold text-[#0F172A]">
                                    <span
                                      className={`ml-1.5 ${
                                        entry.level === 'error'
                                          ? 'text-[#DC2626]'
                                          : entry.level === 'success'
                                            ? 'text-[#16A34A]'
                                            : entry.level === 'warning'
                                              ? 'text-[#D97706]'
                                              : 'text-[#0B4F6C]'
                                      }`}
                                    >
                                      [{LOG_LEVEL_LABELS[entry.level]}]
                                    </span>
                                    {entry.title}
                                  </p>
                                  {entry.details && (
                                    <p className="text-[#475569] mt-0.5 break-words">
                                      {entry.details}
                                    </p>
                                  )}
                                </div>
                              </div>
                              <span className="text-[11px] text-[#64748B] font-mono-num tabular-nums shrink-0">
                                {entry.timestamp}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* Filters */}
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="ابحث باسم المكان أو النطاق أو المعلم..."
                      className="h-10 w-full sm:w-64 px-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-xs text-[#0F172A]"
                    />
                    <select
                      value={statusFilter}
                      onChange={(e) =>
                        setStatusFilter(e.target.value as 'all' | SuggestionStatus)
                      }
                      className="h-10 px-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-xs"
                    >
                      <option value="all">كل الحالات</option>
                      <option value="pending">بانتظار المراجعة</option>
                      <option value="field_check">تحقق ميداني</option>
                      <option value="approved">معتمد ومنشور</option>
                      <option value="rejected">مرفوض</option>
                    </select>
                    <select
                      value={categoryFilter}
                      onChange={(e) =>
                        setCategoryFilter(e.target.value as 'all' | PlaceCategory)
                      }
                      className="h-10 px-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-xs"
                    >
                      <option value="all">كل التصنيفات</option>
                      {(Object.keys(PLACE_CATEGORY_LABELS) as PlaceCategory[]).map(
                        (cat) => (
                          <option key={cat} value={cat}>
                            {PLACE_CATEGORY_LABELS[cat]}
                          </option>
                        )
                      )}
                    </select>
                  </div>

                  {filteredPlaceSuggestions.length === 0 ? (
                    <div className="p-6 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-center text-sm text-[#475569]">
                      لا توجد مقترحات مطابقة للفلتر الحالي.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {filteredPlaceSuggestions.map((item) => {
                        const isEditing = editingPlace?.id === item.id;
                        const activeItem = isEditing ? editingPlace : item;

                        return (
                          <div
                            key={item.id}
                            className="p-4 rounded-xl border border-[#E2E8F0] bg-white space-y-3"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-xs text-[#475569] mb-0.5">
                                  <span
                                    className={`font-semibold ${
                                      item.status === 'field_check'
                                        ? 'text-[#D97706]'
                                        : item.status === 'approved'
                                          ? 'text-[#16A34A]'
                                          : item.status === 'rejected'
                                            ? 'text-[#DC2626]'
                                            : 'text-[#0B4F6C]'
                                    }`}
                                  >
                                    {SUGGESTION_STATUS_LABELS[item.status]}
                                  </span>
                                  <span className="mx-1.5" aria-hidden="true">·</span>
                                  <span>{PLACE_CATEGORY_LABELS[item.category]}</span>
                                  <span className="mx-1.5" aria-hidden="true">·</span>
                                  <span>{item.district}</span>
                                  {typeof item.aiConfidence === 'number' && (
                                    <>
                                      <span className="mx-1.5" aria-hidden="true">·</span>
                                      <span className="font-semibold text-[#0B4F6C] font-mono-num tabular-nums">
                                        ثقة {item.aiConfidence}%
                                        {item.aiVerdict
                                          ? ` (${AI_VERDICT_LABELS[item.aiVerdict]})`
                                          : ''}
                                      </span>
                                    </>
                                  )}
                                </p>
                                <h4 className="text-sm font-bold text-[#0F172A]">
                                  {item.name}
                                </h4>
                                {item.landmarkHint && (
                                  <p className="text-xs text-[#64748B] mt-0.5">
                                    المعلم القريب: {item.landmarkHint}
                                  </p>
                                )}
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                {item.status !== 'approved' && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setEditingPlace(isEditing ? null : {...item})
                                      }
                                      className="min-h-[36px] px-2.5 py-1 text-xs font-medium text-[#475569] border border-[#E2E8F0] hover:text-[#0F172A] rounded-md cursor-pointer"
                                    >
                                      {isEditing ? 'إلغاء' : 'تعديل'}
                                    </button>
                                    {item.status !== 'field_check' && (
                                      <button
                                        type="button"
                                        disabled={actionBusy}
                                        onClick={() =>
                                          void handlePlaceStatusChange(
                                            activeItem,
                                            'field_check'
                                          )
                                        }
                                        className="min-h-[36px] px-2.5 py-1 text-xs font-semibold text-[#D97706] bg-[#D97706]/10 hover:bg-[#D97706]/20 rounded-md cursor-pointer"
                                      >
                                        تحقق ميداني
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      disabled={actionBusy}
                                      onClick={() =>
                                        void handlePlaceStatusChange(
                                          activeItem,
                                          'approved'
                                        )
                                      }
                                      className="min-h-[36px] px-3 py-1 text-xs font-semibold text-white bg-[#0B4F6C] hover:bg-[#083B52] rounded-md cursor-pointer inline-flex items-center gap-1"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                      اعتماد
                                    </button>
                                    <button
                                      type="button"
                                      disabled={actionBusy}
                                      onClick={() =>
                                        void handlePlaceStatusChange(
                                          activeItem,
                                          'rejected'
                                        )
                                      }
                                      className="min-h-[36px] px-2.5 py-1 text-xs font-semibold text-[#DC2626] bg-[#DC2626]/10 hover:bg-[#DC2626]/20 rounded-md cursor-pointer"
                                    >
                                      رفض
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>

                            {(item.sourceReference || item.fieldNotes || item.aiReasoning) && !isEditing && (
                              <div className="text-xs text-[#475569] leading-relaxed space-y-1">
                                {(item.sourceReference || item.fieldNotes) && (
                                  <p>
                                    {item.sourceReference}
                                    {item.sourceReference && item.fieldNotes ? ' — ' : ''}
                                    {item.fieldNotes}
                                  </p>
                                )}
                                {item.aiReasoning && (
                                  <p className="text-[#0B4F6C]">
                                    تقييم المدقق الذكي: {item.aiReasoning}
                                  </p>
                                )}
                              </div>
                            )}

                            {isEditing && editingPlace && (
                              <div className="pt-3 border-t border-[#E2E8F0] grid grid-cols-1 sm:grid-cols-3 gap-3 bg-[#F8FAFC] p-3 rounded-lg">
                                <input
                                  type="text"
                                  value={editingPlace.name}
                                  onChange={(e) =>
                                    setEditingPlace({
                                      ...editingPlace,
                                      name: e.target.value,
                                    })
                                  }
                                  placeholder="الاسم"
                                  className="h-9 px-2.5 rounded border border-[#E2E8F0] bg-white text-xs"
                                />
                                <input
                                  type="text"
                                  value={editingPlace.district}
                                  onChange={(e) =>
                                    setEditingPlace({
                                      ...editingPlace,
                                      district: e.target.value,
                                    })
                                  }
                                  placeholder="النطاق"
                                  className="h-9 px-2.5 rounded border border-[#E2E8F0] bg-white text-xs"
                                />
                                <select
                                  value={editingPlace.category}
                                  onChange={(e) =>
                                    setEditingPlace({
                                      ...editingPlace,
                                      category: e.target.value as PlaceCategory,
                                    })
                                  }
                                  className="h-9 px-2.5 rounded border border-[#E2E8F0] bg-white text-xs"
                                >
                                  {(
                                    Object.keys(
                                      PLACE_CATEGORY_LABELS
                                    ) as PlaceCategory[]
                                  ).map((cat) => (
                                    <option key={cat} value={cat}>
                                      {PLACE_CATEGORY_LABELS[cat]}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  type="text"
                                  value={editingPlace.landmarkHint ?? ''}
                                  onChange={(e) =>
                                    setEditingPlace({
                                      ...editingPlace,
                                      landmarkHint: e.target.value,
                                    })
                                  }
                                  placeholder="أقرب معلم أو تقاطع"
                                  className="sm:col-span-2 h-9 px-2.5 rounded border border-[#E2E8F0] bg-white text-xs"
                                />
                                <input
                                  type="text"
                                  value={editingPlace.reviewNote ?? ''}
                                  onChange={(e) =>
                                    setEditingPlace({
                                      ...editingPlace,
                                      reviewNote: e.target.value,
                                    })
                                  }
                                  placeholder="ملاحظة المراجع"
                                  className="h-9 px-2.5 rounded border border-[#E2E8F0] bg-white text-xs"
                                />
                                <div className="sm:col-span-3 flex justify-end">
                                  <button
                                    type="button"
                                    disabled={actionBusy}
                                    onClick={() =>
                                      void handlePlaceStatusChange(
                                        editingPlace,
                                        editingPlace.status
                                      )
                                    }
                                    className="min-h-[36px] px-3 py-1.5 text-xs font-semibold text-white bg-[#0B4F6C] rounded-md cursor-pointer"
                                  >
                                    حفظ التعديلات
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: Route Suggestions & Direct Admin Route Builder */}
              {tab === 'routes' && (
                <div className="space-y-6">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="text-sm font-bold text-[#0F172A]">
                        مقترحات الخطوط الواردة للمراجعة
                      </h3>
                      {routeSuggestions.some(
                        (r) => r.status === 'pending' || r.status === 'field_check'
                      ) && (
                        <button
                          type="button"
                          disabled={routeHybridBusy || actionBusy}
                          onClick={() => void handleHybridRoutesAudit()}
                          className="min-h-[40px] px-3 py-1.5 text-xs font-semibold text-[#0B4F6C] bg-[#0B4F6C]/10 hover:bg-[#0B4F6C]/20 rounded-lg cursor-pointer inline-flex items-center gap-1.5"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          {routeHybridBusy
                            ? 'جارٍ التدقيق الهجين...'
                            : 'تدقيق واعتماد هجين للخطوط'}
                        </button>
                      )}
                    </div>

                    {routeSuggestions.length === 0 ? (
                      <p className="text-xs text-[#475569]">
                        لا توجد مقترحات خطوط مقدمة حاليًا.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {routeSuggestions.map((rs) => (
                          <div
                            key={rs.id}
                            className="p-4 rounded-xl border border-[#E2E8F0] bg-white flex flex-wrap items-center justify-between gap-4"
                          >
                            <div className="space-y-1">
                              <p className="text-xs text-[#475569] font-mono-num tabular-nums">
                                {SUGGESTION_STATUS_LABELS[rs.status]} ·{' '}
                                {VEHICLE_TYPE_LABELS[rs.vehicleType]} · {rs.fareEgp}{' '}
                                ج.م · {rs.estimatedMinutes} دقيقة
                                {typeof rs.aiConfidence === 'number'
                                  ? ` · ثقة ${rs.aiConfidence}%`
                                  : ''}
                              </p>
                              <h4 className="text-sm font-bold text-[#0F172A]">
                                {rs.generatedName}
                              </h4>
                              <p className="text-xs text-[#475569]">
                                {rs.stopNames.join(' ← ')}
                              </p>
                              {rs.aiReasoning && (
                                <p className="text-xs text-[#0B4F6C]">
                                  تقييم المدقق الذكي: {rs.aiReasoning}
                                </p>
                              )}
                            </div>
                            {rs.status !== 'approved' && rs.status !== 'rejected' && (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={actionBusy}
                                  onClick={() => void handleApproveRouteSuggestion(rs)}
                                  className="min-h-[36px] px-3 py-1.5 text-xs font-semibold text-white bg-[#0B4F6C] rounded-md cursor-pointer"
                                >
                                  اعتماد ونشر
                                </button>
                                <button
                                  type="button"
                                  disabled={actionBusy}
                                  onClick={() =>
                                    void rejectRouteSuggestion(
                                      rs.id,
                                      'مرفوض بعد مراجعة المشرف.'
                                    )
                                  }
                                  className="min-h-[36px] px-3 py-1.5 text-xs font-semibold text-[#DC2626] bg-[#DC2626]/10 rounded-md cursor-pointer"
                                >
                                  رفض
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <form
                    onSubmit={handlePublishDirectRoute}
                    className="p-5 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] space-y-4"
                  >
                    <h3 className="text-sm font-bold text-[#0F172A]">
                      إنشاء ونشر خط موثق جديد مباشرة (من الأماكن الموثقة فقط)
                    </h3>
                    <RouteBuilderControl
                      verifiedPlaces={verifiedPlaces}
                      selectedStops={directStops}
                      onChangeStops={setDirectStops}
                    />
                    {verifiedPlaces.length >= 2 && (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <label className="block text-xs font-semibold text-[#475569] mb-1">
                              نوع المركبة
                            </label>
                            <select
                              value={directVehicle}
                              onChange={(e) =>
                                setDirectVehicle(e.target.value as VehicleType)
                              }
                              className="w-full h-10 px-2.5 rounded border border-[#E2E8F0] bg-white text-xs"
                            >
                              {(
                                Object.keys(VEHICLE_TYPE_LABELS) as VehicleType[]
                              ).map((vt) => (
                                <option key={vt} value={vt}>
                                  {VEHICLE_TYPE_LABELS[vt]}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-[#475569] mb-1">
                              الأجرة (ج.م)
                            </label>
                            <input
                              type="number"
                              min={SCHEMA_LIMITS.FARE_MIN}
                              max={SCHEMA_LIMITS.FARE_MAX}
                              step="0.5"
                              value={directFare}
                              onChange={(e) => setDirectFare(Number(e.target.value))}
                              className="w-full h-10 px-2.5 rounded border border-[#E2E8F0] bg-white text-xs font-mono-num"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-[#475569] mb-1">
                              المدة (دقيقة)
                            </label>
                            <input
                              type="number"
                              min={SCHEMA_LIMITS.MINUTES_MIN}
                              max={SCHEMA_LIMITS.MINUTES_MAX}
                              value={directMinutes}
                              onChange={(e) =>
                                setDirectMinutes(Number(e.target.value))
                              }
                              className="w-full h-10 px-2.5 rounded border border-[#E2E8F0] bg-white text-xs font-mono-num"
                            />
                          </div>
                        </div>
                        <input
                          type="text"
                          value={directNotes}
                          onChange={(e) => setDirectNotes(e.target.value)}
                          placeholder="ملاحظات إضافية للخط (اختياري)"
                          className="w-full h-10 px-3 rounded border border-[#E2E8F0] bg-white text-xs"
                        />
                        <button
                          type="submit"
                          disabled={actionBusy || directStops.length < 2}
                          className="min-h-[44px] px-4 py-2 text-xs font-semibold text-white bg-[#0B4F6C] hover:bg-[#083B52] rounded-lg cursor-pointer disabled:opacity-50"
                        >
                          نشر الخط الموثق الآن
                        </button>
                      </>
                    )}
                  </form>
                </div>
              )}

              {/* TAB 3: Field Reports */}
              {tab === 'reports' && (
                <div className="space-y-3">
                  {reports.length === 0 ? (
                    <p className="text-sm text-[#475569]">
                      لا توجد بلاغات ميدانية واردة حتى الآن.
                    </p>
                  ) : (
                    reports.map((rep) => (
                      <div
                        key={rep.id}
                        className="p-4 rounded-xl border border-[#E2E8F0] bg-white flex flex-wrap items-start justify-between gap-4"
                      >
                        <div className="space-y-1 max-w-2xl">
                          <p className="text-xs text-[#475569]">
                            <span className="font-semibold text-[#D97706]">
                              {REPORT_STATUS_LABELS[rep.status]}
                            </span>
                            <span className="mx-1.5" aria-hidden="true">·</span>
                            <span>{REPORT_TYPE_LABELS[rep.reportType]}</span>
                            {rep.targetLabel && (
                              <>
                                <span className="mx-1.5" aria-hidden="true">·</span>
                                <span>{rep.targetLabel}</span>
                              </>
                            )}
                          </p>
                          <p className="text-sm text-[#0F172A]">{rep.details}</p>
                        </div>
                        <select
                          value={rep.status}
                          onChange={(e) =>
                            void updateReportStatus(
                              rep.id,
                              e.target.value as ReportStatus
                            )
                          }
                          className="h-10 px-2.5 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-xs font-semibold"
                        >
                          {(Object.keys(REPORT_STATUS_LABELS) as ReportStatus[]).map(
                            (st) => (
                              <option key={st} value={st}>
                                {REPORT_STATUS_LABELS[st]}
                              </option>
                            )
                          )}
                        </select>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB 4: Bulk Import & Team Admins */}
              {tab === 'import' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="p-5 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
                        <FileUp className="w-4 h-4 text-[#0B4F6C]" />
                        أداة استيراد وتصدير المقترحات (JSON / CSV)
                      </h3>
                      <button
                        type="button"
                        onClick={handleExportJson}
                        className="text-xs font-semibold text-[#0B4F6C] hover:underline inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        تصدير JSON
                      </button>
                    </div>
                    <p className="text-xs text-[#475569] leading-relaxed">
                      تُدرج كل العناصر المستوردة بحالة <span className="font-mono-num">pending</span> أو <span className="font-mono-num">field_check</span> لتمر عبر التدقيق الهجين. صيغة CSV: <span className="font-mono-num">name,category,district,landmarkHint,status,sourceReference,fieldNotes</span>
                    </p>
                    <input
                      type="file"
                      accept=".json,.csv,.txt"
                      onChange={handleFileUpload}
                      className="block w-full text-xs text-[#475569] file:ml-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-[#E2E8F0] file:text-xs file:font-semibold file:bg-white file:text-[#0F172A]"
                    />
                    <textarea
                      rows={6}
                      value={importText}
                      onChange={(e) => setImportText(e.target.value)}
                      placeholder='[{"name": "مثال", "category": "pickup_point", "district": "شرق الإسكندرية", "landmarkHint": "أمام محطة الترام", "status": "pending"}]'
                      className="w-full p-3 rounded-lg border border-[#E2E8F0] bg-white text-xs font-mono-num"
                      dir="ltr"
                    />
                    <label className="flex items-center gap-2 text-xs text-[#0F172A]">
                      <input
                        type="checkbox"
                        checked={replaceInitial}
                        onChange={(e) => setReplaceInitial(e.target.checked)}
                      />
                      استبدال المقترحات الأولية غير المعتمدة بالقائمة الجديدة
                    </label>
                    <button
                      type="button"
                      disabled={actionBusy || !importText.trim()}
                      onClick={() => void handleImportSubmit()}
                      className="min-h-[44px] px-4 py-2 text-xs font-semibold text-white bg-[#0B4F6C] hover:bg-[#083B52] rounded-lg cursor-pointer disabled:opacity-50"
                    >
                      استيراد للتدقيق الهجين
                    </button>
                  </div>

                  <div className="p-5 rounded-xl border border-[#E2E8F0] bg-white space-y-4">
                    <h3 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
                      <Database className="w-4 h-4 text-[#0B4F6C]" />
                      أعضاء فريق الإشراف المعتمدون
                    </h3>
                    <form onSubmit={handleAddAdmin} className="space-y-2.5">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <input
                          type="text"
                          required
                          value={newAdminUid}
                          onChange={(e) => setNewAdminUid(e.target.value)}
                          placeholder="معرّف المستخدم (UID)"
                          className="h-10 px-2.5 rounded border border-[#E2E8F0] bg-[#F8FAFC] text-xs font-mono-num"
                          dir="ltr"
                        />
                        <input
                          type="text"
                          required
                          value={newAdminName}
                          onChange={(e) => setNewAdminName(e.target.value)}
                          placeholder="اسم المشرف"
                          className="h-10 px-2.5 rounded border border-[#E2E8F0] bg-[#F8FAFC] text-xs"
                        />
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="email"
                          required
                          value={newAdminEmail}
                          onChange={(e) => setNewAdminEmail(e.target.value)}
                          placeholder="البريد الإلكتروني (Google)"
                          className="flex-1 h-10 px-2.5 rounded border border-[#E2E8F0] bg-[#F8FAFC] text-xs"
                          dir="ltr"
                        />
                        <button
                          type="submit"
                          disabled={actionBusy}
                          className="min-h-[40px] px-3 text-xs font-semibold text-white bg-[#0B4F6C] rounded-md cursor-pointer inline-flex items-center gap-1 shrink-0"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          إضافة مشرف
                        </button>
                      </div>
                    </form>

                    <div className="divide-y divide-[#E2E8F0]">
                      {adminsList.length === 0 ? (
                        <p className="text-xs text-[#64748B] py-2">
                          يعمل المشرف الأساسي حاليًا عبر القائمة الموثقة في قواعد الأمان.
                        </p>
                      ) : (
                        adminsList.map((adm) => (
                          <div
                            key={adm.uid}
                            className="py-2.5 flex items-center justify-between gap-2 text-xs"
                          >
                            <div>
                              <p className="font-bold text-[#0F172A]">
                                {adm.displayName}
                              </p>
                              <p className="text-[#475569] font-mono-num">
                                {adm.email} · {adm.uid}
                              </p>
                            </div>
                            {adm.uid !== user.uid && (
                              <button
                                type="button"
                                onClick={() => void removeAdminMember(adm.uid)}
                                className="min-h-[36px] min-w-[36px] flex items-center justify-center text-[#DC2626] hover:bg-[#DC2626]/10 rounded cursor-pointer"
                                aria-label="حذف المشرف"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
