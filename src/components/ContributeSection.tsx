import React, {useState} from 'react';
import {User} from 'firebase/auth';
import {
  AlertCircle,
  CheckCircle2,
  Flag,
  LogIn,
  MapPinPlus,
  RefreshCw,
  Route as RouteIcon,
  Sparkles,
} from 'lucide-react';
import {
  AI_VERDICT_LABELS,
  ALEXANDRIA_ZONES,
  AuditLogEntry,
  PLACE_CATEGORY_LABELS,
  PlaceCategory,
  PlaceSuggestion,
  REPORT_STATUS_LABELS,
  REPORT_TYPE_LABELS,
  ReportTargetType,
  ReportType,
  RouteSuggestion,
  SCHEMA_LIMITS,
  SUGGESTION_STATUS_LABELS,
  TransitReport,
  VEHICLE_TYPE_LABELS,
  VehicleType,
  VerifiedPlace,
  VerifiedRoute,
} from '../types/transit';
import {
  submitPlaceAndAutoPublishIfTrusted,
  submitRouteAndAutoPublishIfTrusted,
  submitTransitReport,
} from '../lib/firestoreService';
import {
  evaluateSuggestionWithAi,
  SuggestionEvaluationResponse,
} from '../lib/aiApi';
import {generateRouteMeta} from '../lib/routing';
import {RouteBuilderControl} from './RouteBuilderControl';

interface ContributeSectionProps {
  user: User | null;
  isAdmin: boolean;
  onSignIn: () => Promise<void>;
  verifiedPlaces: VerifiedPlace[];
  verifiedRoutes: VerifiedRoute[];
  myPlaceSuggestions: PlaceSuggestion[];
  myRouteSuggestions: RouteSuggestion[];
  myReports: TransitReport[];
  onRecordAuditLog?: (entry: Omit<AuditLogEntry, 'id' | 'timestamp'>) => void;
}

export const ContributeSection: React.FC<ContributeSectionProps> = ({
  user,
  isAdmin,
  onSignIn,
  verifiedPlaces,
  verifiedRoutes,
  myPlaceSuggestions,
  myRouteSuggestions,
  myReports,
  onRecordAuditLog,
}) => {
  const [activeTab, setActiveTab] = useState<'place' | 'route' | 'report'>('place');
  const [busy, setBusy] = useState(false);
  const [aiChecking, setAiChecking] = useState(false);
  const [aiPreview, setAiPreview] = useState<SuggestionEvaluationResponse | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);

  // Place suggestion form
  const [placeName, setPlaceName] = useState('');
  const [placeCategory, setPlaceCategory] =
    useState<PlaceCategory>('pickup_point');
  const [placeDistrict, setPlaceDistrict] = useState<string>(ALEXANDRIA_ZONES[0]);
  const [landmarkHint, setLandmarkHint] = useState('');
  const [sourceRef, setSourceRef] = useState('');
  const [fieldNotes, setFieldNotes] = useState('');

  // Route suggestion form
  const [routeStops, setRouteStops] = useState<VerifiedPlace[]>([]);
  const [fareEgp, setFareEgp] = useState<number>(8);
  const [estimatedMinutes, setEstimatedMinutes] = useState<number>(25);
  const [vehicleType, setVehicleType] = useState<VehicleType>('microbus');
  const [routeNotes, setRouteNotes] = useState('');

  // Report form
  const [targetType, setTargetType] = useState<ReportTargetType>('general');
  const [targetId, setTargetId] = useState('');
  const [reportType, setReportType] = useState<ReportType>('fare_change');
  const [suggestedFare, setSuggestedFare] = useState<string>('');
  const [reportDetails, setReportDetails] = useState('');

  const handleRunPlaceAiCheck = async () => {
    if (!placeName.trim()) return;
    setAiChecking(true);
    setAiError(null);
    setFeedback(null);
    try {
      const evaluation = await evaluateSuggestionWithAi({
        kind: 'place',
        item: {
          name: placeName,
          category: placeCategory,
          district: placeDistrict,
          landmarkHint,
          sourceReference: sourceRef,
          fieldNotes,
        },
        existingNames: verifiedPlaces.map((p) => p.name),
      });
      setAiPreview(evaluation);
      onRecordAuditLog?.({
        level: evaluation.verdict === 'auto_approve' ? 'success' : 'info',
        title: `تقييم فوري للمكان «${placeName.trim()}»`,
        details: `الثقة ${evaluation.confidence}% · ${AI_VERDICT_LABELS[evaluation.verdict]} — ${evaluation.reasoning}`,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'تعذر تشغيل المدقق الذكي حاليًا.';
      setAiError(msg);
      onRecordAuditLog?.({
        level: 'error',
        title: `تعذر التقييم الذكي للمكان «${placeName.trim()}»`,
        details: msg,
      });
    } finally {
      setAiChecking(false);
    }
  };

  const handleSubmitPlace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setFeedback(null);
    setAiError(null);

    let evaluation = aiPreview;
    let evaluationFailureMsg: string | null = null;

    if (!evaluation) {
      try {
        evaluation = await evaluateSuggestionWithAi({
          kind: 'place',
          item: {
            name: placeName,
            category: placeCategory,
            district: placeDistrict,
            landmarkHint,
            sourceReference: sourceRef,
            fieldNotes,
          },
          existingNames: verifiedPlaces.map((p) => p.name),
        });
      } catch (err) {
        evaluation = null;
        evaluationFailureMsg =
          err instanceof Error
            ? err.message
            : 'تعذر التواصل مع خدمة التقييم الذكي.';
        setAiError(evaluationFailureMsg);
        onRecordAuditLog?.({
          level: 'error',
          title: `فشل التقييم التلقائي عند إرسال «${placeName.trim()}»`,
          details: evaluationFailureMsg,
        });
      }
    }

    try {
      const {autoPublishedPlaceId} = await submitPlaceAndAutoPublishIfTrusted({
        uid: user.uid,
        isAdmin,
        name: placeName,
        category: placeCategory,
        district: placeDistrict,
        landmarkHint,
        sourceReference: sourceRef,
        fieldNotes,
        aiConfidence: evaluation?.confidence,
        aiVerdict: evaluation?.verdict,
        aiReasoning: evaluation?.reasoning,
      });

      const submittedName = placeName.trim();
      setPlaceName('');
      setLandmarkHint('');
      setSourceRef('');
      setFieldNotes('');
      setAiPreview(null);

      if (autoPublishedPlaceId && evaluation) {
        onRecordAuditLog?.({
          level: 'success',
          title: `اعتماد ونشر فوري للمكان «${submittedName}»`,
          details: `ثقة ${evaluation.confidence}% · ${evaluation.reasoning}`,
        });
        setFeedback({
          type: 'success',
          message: `تم التقييم الذكي (${evaluation.confidence}%) والاعتماد والنشر الفوري للمكان «${submittedName}» في الدليل العام.`,
        });
      } else if (evaluation) {
        onRecordAuditLog?.({
          level: 'info',
          title: `تم تقييم وحفظ «${submittedName}»`,
          details: `ثقة ${evaluation.confidence}% · ${AI_VERDICT_LABELS[evaluation.verdict]}`,
        });
        setFeedback({
          type: 'success',
          message: `تم إرسال المقترح وتقييمه ذكيًا (ثقة ${evaluation.confidence}% · ${AI_VERDICT_LABELS[evaluation.verdict]}). سيدخل ضمن دورة الاعتماد الهجين التلقائي.`,
        });
      } else {
        setFeedback({
          type: 'warning',
          message: `تم حفظ مقترح «${submittedName}» في قائمة الانتظار، ولكن تعذر التقييم الذكي الفوري: ${evaluationFailureMsg || 'خطأ مؤقت في الاتصال'}.`,
        });
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'تعذر إرسال المقترح.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setFeedback(null);

    const {name, direction} = generateRouteMeta(routeStops);
    let evaluation: SuggestionEvaluationResponse | null = null;
    let evalFailure: string | null = null;

    try {
      evaluation = await evaluateSuggestionWithAi({
        kind: 'route',
        item: {
          generatedName: name,
          generatedDirection: direction,
          stopNames: routeStops.map((s) => s.name),
          fareEgp,
          estimatedMinutes,
          vehicleType,
          notes: routeNotes,
        },
        existingNames: verifiedRoutes.map((r) => r.name),
      });
    } catch (err) {
      evaluation = null;
      evalFailure =
        err instanceof Error
          ? err.message
          : 'تعذر تشغيل المدقق الذكي للخط حاليًا.';
      onRecordAuditLog?.({
        level: 'error',
        title: `تعذر التقييم الذكي للخط «${name}»`,
        details: evalFailure,
      });
    }

    try {
      const {autoPublishedRouteId} = await submitRouteAndAutoPublishIfTrusted({
        uid: user.uid,
        isAdmin,
        stops: routeStops,
        fareEgp,
        estimatedMinutes,
        vehicleType,
        notes: routeNotes,
        aiConfidence: evaluation?.confidence,
        aiVerdict: evaluation?.verdict,
        aiReasoning: evaluation?.reasoning,
      });

      setRouteStops([]);
      setRouteNotes('');

      if (autoPublishedRouteId && evaluation) {
        onRecordAuditLog?.({
          level: 'success',
          title: `اعتماد ونشر فوري للخط «${name}»`,
          details: `ثقة ${evaluation.confidence}% · ${evaluation.reasoning}`,
        });
        setFeedback({
          type: 'success',
          message: `تم التقييم الذكي (${evaluation.confidence}%) ونشر «${name}» تلقائيًا في البحث العام.`,
        });
      } else if (evaluation) {
        setFeedback({
          type: 'success',
          message: `تم إرسال مقترح الخط وتقييمه ذكيًا (ثقة ${evaluation.confidence}% · ${AI_VERDICT_LABELS[evaluation.verdict]}).`,
        });
      } else {
        setFeedback({
          type: 'warning',
          message: `تم حفظ مقترح الخط للمراجعة، ولكن تعذر التقييم الذكي التلقائي: ${evalFailure || 'خطأ مؤقت'}.`,
        });
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'تعذر إرسال مقترح الخط.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setFeedback(null);

    let targetLabel = '';
    if (targetType === 'route' && targetId) {
      targetLabel =
        verifiedRoutes.find((r) => r.id === targetId)?.name ?? targetId;
    } else if (targetType === 'place' && targetId) {
      targetLabel =
        verifiedPlaces.find((p) => p.id === targetId)?.name ?? targetId;
    }

    try {
      await submitTransitReport({
        uid: user.uid,
        targetType,
        targetId: targetId || undefined,
        targetLabel: targetLabel || undefined,
        reportType,
        details: reportDetails,
        suggestedFareEgp: suggestedFare ? Number(suggestedFare) : undefined,
      });
      setReportDetails('');
      setSuggestedFare('');
      setTargetId('');
      setFeedback({
        type: 'success',
        message: 'تم استلام البلاغ الميداني وإضافته إلى قائمة مراجعة الفريق.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'تعذر إرسال البلاغ.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      id="contribute-section"
      className="bg-white border border-[#E2E8F0] rounded-2xl p-5 md:p-8 space-y-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-[#0B4F6C] mb-1">
            المساهمة المجتمعية · المدعومة بالتقييم الذكي الفوري
          </p>
          <h2 className="text-xl font-bold text-[#0F172A]">
            اقتراح مكان أو خط أو إرسال بلاغ ميداني
          </h2>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#F1F5F9] rounded-lg overflow-x-auto max-w-full">
          <button
            type="button"
            onClick={() => {
              setActiveTab('place');
              setFeedback(null);
            }}
            className={`min-h-[44px] md:min-h-[34px] px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5 ${
              activeTab === 'place'
                ? 'bg-white text-[#0F172A] shadow-sm'
                : 'text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            <MapPinPlus className="w-3.5 h-3.5" />
            اقتراح مكان
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('route');
              setFeedback(null);
            }}
            className={`min-h-[44px] md:min-h-[34px] px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5 ${
              activeTab === 'route'
                ? 'bg-white text-[#0F172A] shadow-sm'
                : 'text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            <RouteIcon className="w-3.5 h-3.5" />
            اقتراح خط
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('report');
              setFeedback(null);
            }}
            className={`min-h-[44px] md:min-h-[34px] px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5 ${
              activeTab === 'report'
                ? 'bg-white text-[#0F172A] shadow-sm'
                : 'text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            <Flag className="w-3.5 h-3.5" />
            بلاغ ميداني
          </button>
        </div>
      </div>

      {!user ? (
        <div className="rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] p-5 md:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-[#0F172A]">
              سجّل الدخول بحساب Google لتقديم مقترح أو بلاغ
            </h3>
            <p className="text-xs text-[#475569] leading-relaxed max-w-xl">
              نربط كل مساهمة بحساب موثق لمنع الإدخالات العشوائية، ويقوم المدقق الذكي بفحص المقترح فورًا وإعطائه نسبة ثقة واضحة.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void onSignIn()}
            className="min-h-[44px] px-4 py-2.5 text-xs font-semibold text-white bg-[#0B4F6C] hover:bg-[#083B52] rounded-lg transition-colors inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
          >
            <LogIn className="w-4 h-4" />
            الدخول بحساب Google للمساهمة
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {feedback && (
            <div
              className={`p-4 rounded-xl border text-sm flex items-start gap-2.5 ${
                feedback.type === 'success'
                  ? 'bg-[#16A34A]/5 border-[#16A34A]/30 text-[#14532D]'
                  : feedback.type === 'warning'
                    ? 'bg-[#D97706]/10 border-[#D97706]/30 text-[#92400E]'
                    : 'bg-[#DC2626]/5 border-[#DC2626]/30 text-[#991B1B]'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[#16A34A]" />
              ) : (
                <AlertCircle
                  className={`w-4 h-4 shrink-0 mt-0.5 ${
                    feedback.type === 'warning' ? 'text-[#D97706]' : 'text-[#DC2626]'
                  }`}
                />
              )}
              <span>{feedback.message}</span>
            </div>
          )}

          {activeTab === 'place' && (
            <form
              onSubmit={handleSubmitPlace}
              className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
            >
              <div className="lg:col-span-7 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1.5">
                    اسم المكان أو الموقف المقترح
                  </label>
                  <input
                    type="text"
                    required
                    minLength={SCHEMA_LIMITS.NAME_MIN}
                    maxLength={SCHEMA_LIMITS.NAME_MAX}
                    value={placeName}
                    onChange={(e) => {
                      setPlaceName(e.target.value);
                      setAiPreview(null);
                      setAiError(null);
                    }}
                    placeholder="مثال: تقاطع مصطفى كامل — رشدي"
                    className="w-full h-11 px-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0B4F6C]"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#475569] mb-1.5">
                      التصنيف
                    </label>
                    <select
                      value={placeCategory}
                      onChange={(e) => {
                        setPlaceCategory(e.target.value as PlaceCategory);
                        setAiPreview(null);
                      }}
                      className="w-full h-11 px-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-sm text-[#0F172A]"
                    >
                      {(Object.keys(PLACE_CATEGORY_LABELS) as PlaceCategory[]).map(
                        (cat) => (
                          <option key={cat} value={cat}>
                            {PLACE_CATEGORY_LABELS[cat]}
                          </option>
                        )
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#475569] mb-1.5">
                      النطاق الجغرافي في الإسكندرية
                    </label>
                    <select
                      value={placeDistrict}
                      onChange={(e) => {
                        setPlaceDistrict(e.target.value);
                        setAiPreview(null);
                      }}
                      className="w-full h-11 px-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-sm text-[#0F172A]"
                    >
                      {ALEXANDRIA_ZONES.map((z) => (
                        <option key={z} value={z}>
                          {z}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1.5">
                    أقرب معلم أو تقاطع رئيسي
                  </label>
                  <input
                    type="text"
                    maxLength={SCHEMA_LIMITS.LANDMARK_MAX}
                    value={landmarkHint}
                    onChange={(e) => {
                      setLandmarkHint(e.target.value);
                      setAiPreview(null);
                    }}
                    placeholder="مثال: أمام محطة الترام أو تقاطع شارع بورسعيد"
                    className="w-full h-11 px-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-sm text-[#0F172A]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1.5">
                    المرجع أو وصف نقطة التوقف (اختياري)
                  </label>
                  <input
                    type="text"
                    maxLength={SCHEMA_LIMITS.NOTE_MAX}
                    value={sourceRef}
                    onChange={(e) => setSourceRef(e.target.value)}
                    placeholder="مثال: خط سرفيس متكرر / موقف خدمة معروف"
                    className="w-full h-11 px-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-sm text-[#0F172A]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1.5">
                    ملاحظات ميدانية للمراجع (اختياري)
                  </label>
                  <textarea
                    rows={3}
                    maxLength={SCHEMA_LIMITS.NOTE_MAX}
                    value={fieldNotes}
                    onChange={(e) => setFieldNotes(e.target.value)}
                    className="w-full p-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-sm text-[#0F172A]"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={aiChecking || !placeName.trim()}
                    onClick={() => void handleRunPlaceAiCheck()}
                    className="min-h-[44px] px-4 py-2.5 text-xs font-semibold text-[#0B4F6C] bg-[#0B4F6C]/10 hover:bg-[#0B4F6C]/20 rounded-lg transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    {aiChecking ? 'جارٍ التقييم...' : 'معاينة تقييم المدقق الذكي'}
                  </button>

                  <button
                    type="submit"
                    disabled={busy}
                    className="min-h-[44px] px-5 py-2.5 text-sm font-semibold text-white bg-[#0B4F6C] hover:bg-[#083B52] rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                  >
                    {busy ? 'جارٍ التقييم والإرسال...' : 'إرسال مقترح المكان'}
                  </button>
                </div>
              </div>

              {/* AI Auditor Preview & Explicit Error Log Panel */}
              <div className="lg:col-span-5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] p-5 space-y-4">
                <div className="flex items-center gap-2 text-sm font-bold text-[#0F172A]">
                  <Sparkles className="w-4 h-4 text-[#0B4F6C]" />
                  المدقق الذكي للاعتماد الفوري
                </div>
                <p className="text-xs text-[#475569] leading-relaxed">
                  يتحقق المدقق الذكي من دقة الاسم في الإسكندرية والنطاق وأقرب معلم ويعطي نسبة ثقة فورية؛ وتُظهر أي أعطال مؤقتة هنا بوضوح دون إخفاء.
                </p>

                {aiError && (
                  <div className="p-4 rounded-lg bg-[#DC2626]/5 border border-[#DC2626]/30 text-xs text-[#991B1B] space-y-2.5">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#DC2626]" />
                      <span className="leading-relaxed">{aiError}</span>
                    </div>
                    <button
                      type="button"
                      disabled={aiChecking || !placeName.trim()}
                      onClick={() => void handleRunPlaceAiCheck()}
                      className="min-h-[36px] px-3 py-1.5 rounded-md bg-white border border-[#DC2626]/30 text-[#991B1B] font-semibold inline-flex items-center gap-1.5 cursor-pointer hover:bg-[#DC2626]/10"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      إعادة محاولة التقييم الذكي
                    </button>
                  </div>
                )}

                {aiPreview ? (
                  <div className="p-4 rounded-lg bg-white border border-[#E2E8F0] space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-[#0B4F6C]">
                        {AI_VERDICT_LABELS[aiPreview.verdict]}
                      </span>
                      <span className="font-bold text-[#0F172A] font-mono-num tabular-nums">
                        نسبة الثقة: {aiPreview.confidence}%
                      </span>
                    </div>
                    <p className="text-xs text-[#475569] leading-relaxed">
                      {aiPreview.reasoning}
                    </p>
                    <p className="text-[11px] text-[#64748B]">
                      التصنيف المقترح:{' '}
                      {PLACE_CATEGORY_LABELS[aiPreview.suggestedCategory] ||
                        aiPreview.suggestedCategory}{' '}
                      · {aiPreview.normalizedDistrict || placeDistrict}
                    </p>
                  </div>
                ) : (
                  !aiError && (
                    <div className="p-4 rounded-lg bg-white border border-dashed border-[#E2E8F0] text-xs text-[#64748B]">
                      أدخل اسم المكان والنطاق واضغط «معاينة تقييم المدقق الذكي» أو أرسل مباشرة ليتم تقييمه آليًا مع الإرسال.
                    </div>
                  )
                )}
              </div>
            </form>
          )}

          {activeTab === 'route' && (
            <form onSubmit={handleSubmitRoute} className="space-y-5">
              <RouteBuilderControl
                verifiedPlaces={verifiedPlaces}
                selectedStops={routeStops}
                onChangeStops={setRouteStops}
              />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1.5">
                    نوع المركبة
                  </label>
                  <select
                    value={vehicleType}
                    onChange={(e) =>
                      setVehicleType(e.target.value as VehicleType)
                    }
                    className="w-full h-11 px-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-sm text-[#0F172A]"
                  >
                    {(Object.keys(VEHICLE_TYPE_LABELS) as VehicleType[]).map(
                      (vt) => (
                        <option key={vt} value={vt}>
                          {VEHICLE_TYPE_LABELS[vt]}
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1.5">
                    الأجرة التقديرية للفرد (ج.م)
                  </label>
                  <input
                    type="number"
                    min={SCHEMA_LIMITS.FARE_MIN}
                    max={SCHEMA_LIMITS.FARE_MAX}
                    step="0.5"
                    value={fareEgp}
                    onChange={(e) => setFareEgp(Number(e.target.value))}
                    className="w-full h-11 px-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-sm font-mono-num tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1.5">
                    المدة التقديرية (دقيقة)
                  </label>
                  <input
                    type="number"
                    min={SCHEMA_LIMITS.MINUTES_MIN}
                    max={SCHEMA_LIMITS.MINUTES_MAX}
                    value={estimatedMinutes}
                    onChange={(e) => setEstimatedMinutes(Number(e.target.value))}
                    className="w-full h-11 px-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-sm font-mono-num tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#475569] mb-1.5">
                  ملاحظات المسار (اختياري)
                </label>
                <input
                  type="text"
                  maxLength={SCHEMA_LIMITS.NOTE_MAX}
                  value={routeNotes}
                  onChange={(e) => setRouteNotes(e.target.value)}
                  placeholder="مثال: يمر من طريق الكورنيش أو شارع أبو قير"
                  className="w-full h-11 px-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-sm text-[#0F172A]"
                />
              </div>

              <button
                type="submit"
                disabled={busy || routeStops.length < 2}
                className="min-h-[44px] px-5 py-2.5 text-sm font-semibold text-white bg-[#0B4F6C] hover:bg-[#083B52] rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                {busy ? 'جارٍ التقييم والإرسال...' : 'إرسال مقترح الخط للتقييم'}
              </button>
            </form>
          )}

          {activeTab === 'report' && (
            <form onSubmit={handleSubmitReport} className="space-y-4 max-w-2xl">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1.5">
                    نوع البلاغ
                  </label>
                  <select
                    value={reportType}
                    onChange={(e) => setReportType(e.target.value as ReportType)}
                    className="w-full h-11 px-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-sm text-[#0F172A]"
                  >
                    {(Object.keys(REPORT_TYPE_LABELS) as ReportType[]).map(
                      (rt) => (
                        <option key={rt} value={rt}>
                          {REPORT_TYPE_LABELS[rt]}
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1.5">
                    نطاق البلاغ
                  </label>
                  <select
                    value={targetType}
                    onChange={(e) => {
                      setTargetType(e.target.value as ReportTargetType);
                      setTargetId('');
                    }}
                    className="w-full h-11 px-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-sm text-[#0F172A]"
                  >
                    <option value="general">ملاحظة عامة عن الشبكة</option>
                    <option value="place">مكان موثق</option>
                    <option value="route">خط موثق</option>
                  </select>
                </div>
              </div>

              {targetType === 'place' && (
                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1.5">
                    اختر المكان الموثق
                  </label>
                  <select
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    className="w-full h-11 px-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-sm text-[#0F172A]"
                  >
                    <option value="">اختر مكانًا...</option>
                    {verifiedPlaces.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {targetType === 'route' && (
                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1.5">
                    اختر الخط الموثق
                  </label>
                  <select
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    className="w-full h-11 px-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-sm text-[#0F172A]"
                  >
                    <option value="">اختر خطًا...</option>
                    {verifiedRoutes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {reportType === 'fare_change' && (
                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1.5">
                    الأجرة المرصودة بالجنيه (اختياري)
                  </label>
                  <input
                    type="number"
                    min={SCHEMA_LIMITS.FARE_MIN}
                    max={SCHEMA_LIMITS.FARE_MAX}
                    step="0.5"
                    value={suggestedFare}
                    onChange={(e) => setSuggestedFare(e.target.value)}
                    className="w-full sm:w-56 h-11 px-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-sm font-mono-num tabular-nums"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#475569] mb-1.5">
                  تفاصيل البلاغ الميداني
                </label>
                <textarea
                  required
                  minLength={SCHEMA_LIMITS.DETAILS_MIN}
                  maxLength={SCHEMA_LIMITS.DETAILS_MAX}
                  rows={4}
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                  placeholder="اكتب ما لاحظته ميدانيًا بوضوح..."
                  className="w-full p-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-sm text-[#0F172A]"
                />
              </div>

              <button
                type="submit"
                disabled={busy}
                className="min-h-[44px] px-5 py-2.5 text-sm font-semibold text-white bg-[#0B4F6C] hover:bg-[#083B52] rounded-lg transition-colors cursor-pointer disabled:opacity-60"
              >
                {busy ? 'جارٍ الإرسال...' : 'إرسال البلاغ'}
              </button>
            </form>
          )}

          {/* Signed-in contributor's personal submissions */}
          {(myPlaceSuggestions.length > 0 ||
            myRouteSuggestions.length > 0 ||
            myReports.length > 0) && (
            <div className="pt-6 border-t border-[#E2E8F0] space-y-3">
              <h3 className="text-sm font-bold text-[#0F172A]">
                متابعة مساهماتك المرسلة
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {myPlaceSuggestions.slice(0, 6).map((item) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-xs space-y-1"
                  >
                    <p className="font-semibold text-[#0B4F6C] font-mono-num tabular-nums">
                      مكان · {SUGGESTION_STATUS_LABELS[item.status]}
                      {typeof item.aiConfidence === 'number'
                        ? ` · ثقة ${item.aiConfidence}%`
                        : ''}
                    </p>
                    <p className="font-bold text-[#0F172A]">{item.name}</p>
                    {item.aiReasoning && (
                      <p className="text-[#475569]">{item.aiReasoning}</p>
                    )}
                    {item.reviewNote && (
                      <p className="text-[#475569]">{item.reviewNote}</p>
                    )}
                  </div>
                ))}
                {myRouteSuggestions.slice(0, 4).map((item) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-xs space-y-1"
                  >
                    <p className="font-semibold text-[#0B4F6C] font-mono-num tabular-nums">
                      خط · {SUGGESTION_STATUS_LABELS[item.status]}
                      {typeof item.aiConfidence === 'number'
                        ? ` · ثقة ${item.aiConfidence}%`
                        : ''}
                    </p>
                    <p className="font-bold text-[#0F172A]">
                      {item.generatedName}
                    </p>
                    {item.aiReasoning && (
                      <p className="text-[#475569]">{item.aiReasoning}</p>
                    )}
                  </div>
                ))}
                {myReports.slice(0, 4).map((rep) => (
                  <div
                    key={rep.id}
                    className="p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-xs space-y-1"
                  >
                    <p className="font-semibold text-[#D97706]">
                      بلاغ · {REPORT_STATUS_LABELS[rep.status]}
                    </p>
                    <p className="text-[#0F172A] line-clamp-2">{rep.details}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
