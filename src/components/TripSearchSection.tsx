import React, {useEffect, useMemo, useState} from 'react';
import {
  ArrowLeftRight,
  Calculator,
  Check,
  Clock,
  Coins,
  Copy,
  MapPin,
  RotateCcw,
  Route as RouteIcon,
  Search,
  Share2,
  ShieldCheck,
} from 'lucide-react';
import {
  ALEXANDRIA_ZONES,
  PLACE_CATEGORY_LABELS,
  PublicStats,
  TripLeg,
  TripOption,
  VEHICLE_TYPE_LABELS,
  VerifiedPlace,
  VerifiedRoute,
} from '../types/transit';
import {calculateTripFareAndTime, findVerifiedTrips} from '../lib/routing';

interface TripSearchSectionProps {
  places: VerifiedPlace[];
  routes: VerifiedRoute[];
  publicStats: PublicStats | null;
  originId: string;
  destinationId: string;
  onChangeOrigin: (id: string) => void;
  onChangeDestination: (id: string) => void;
  selectedTrip: TripOption | null;
  onSelectTrip: (trip: TripOption | null) => void;
  onNavigateContribute: () => void;
  onNavigateAiAssistant: () => void;
}

interface ItineraryStep {
  stepKey: string;
  stop: VerifiedPlace;
  legIdx: number;
  leg: TripLeg;
  stepNumber: number;
  isTransferHandoff: boolean;
  nextLeg?: TripLeg;
}

export const TripSearchSection: React.FC<TripSearchSectionProps> = ({
  places,
  routes,
  publicStats,
  originId,
  destinationId,
  onChangeOrigin,
  onChangeDestination,
  selectedTrip,
  onSelectTrip,
  onNavigateContribute,
  onNavigateAiAssistant,
}) => {
  const [sortBy, setSortBy] = useState<'fastest' | 'cheapest'>('fastest');
  const [zoneFilter, setZoneFilter] = useState<string>('all');
  const [routeFilter, setRouteFilter] = useState('');
  const [completedStepKeys, setCompletedStepKeys] = useState<string[]>([]);
  const [copiedSummary, setCopiedSummary] = useState(false);

  const filteredPlacesForSelect = useMemo(() => {
    if (zoneFilter === 'all') return places;
    return places.filter((p) => p.district === zoneFilter);
  }, [places, zoneFilter]);

  const tripResults = useMemo(() => {
    return findVerifiedTrips(
      originId,
      destinationId,
      places,
      routes,
      sortBy
    );
  }, [originId, destinationId, places, routes, sortBy]);

  const activeTrip = selectedTrip ?? tripResults[0] ?? null;

  useEffect(() => {
    setCompletedStepKeys([]);
    setCopiedSummary(false);
  }, [activeTrip?.id]);

  const calculation = useMemo(() => {
    if (!activeTrip) return null;
    return calculateTripFareAndTime(activeTrip);
  }, [activeTrip]);

  const itinerarySteps = useMemo<ItineraryStep[]>(() => {
    if (!activeTrip) return [];
    const steps: ItineraryStep[] = [];
    let counter = 1;
    activeTrip.legs.forEach((leg, legIdx) => {
      leg.subStops.forEach((stop, stopIdx) => {
        const isLastOfFirstTransferLeg =
          activeTrip.type === 'transfer' &&
          legIdx === 0 &&
          stopIdx === leg.subStops.length - 1;
        const isDuplicateTransferStart =
          activeTrip.type === 'transfer' && legIdx === 1 && stopIdx === 0;
        if (isDuplicateTransferStart) return;
        steps.push({
          stepKey: `${legIdx}-${stop.id}-${stopIdx}`,
          stop,
          legIdx,
          leg,
          stepNumber: counter++,
          isTransferHandoff: isLastOfFirstTransferLeg,
          nextLeg: isLastOfFirstTransferLeg ? activeTrip.legs[1] : undefined,
        });
      });
    });
    return steps;
  }, [activeTrip]);

  const shareText = useMemo(() => {
    if (!activeTrip || !calculation) return '';
    const originName = activeTrip.legs[0]?.fromPlace.name ?? '';
    const destName =
      activeTrip.legs[activeTrip.legs.length - 1]?.toPlace.name ?? '';
    const legsDesc = activeTrip.legs
      .map(
        (l, idx) =>
          `${idx + 1}) ${VEHICLE_TYPE_LABELS[l.route.vehicleType]} «${l.route.name}» (${l.fareEgp} ج.م · ${l.estimatedMinutes} د)`
      )
      .join('\n');
    const stopsDesc = itinerarySteps.map((s) => s.stop.name).join(' ← ');
    const transferLine =
      activeTrip.type === 'transfer' && activeTrip.transferPlace
        ? `\nنقطة التبديل: ${activeTrip.transferPlace.name}`
        : '';
    return [
      `مشروعي — رحلة مواصلات الإسكندرية`,
      `من: ${originName} ← إلى: ${destName}`,
      `الأجرة للفرد: ${calculation.farePerRider} ج.م · الزمن التقديري: ${calculation.totalMinutes} دقيقة`,
      `الخطوط:\n${legsDesc}${transferLine}`,
      `خط السير: ${stopsDesc}`,
    ].join('\n');
  }, [activeTrip, calculation, itinerarySteps]);

  const whatsappHref = useMemo(() => {
    if (!shareText) return '#';
    return `https://wa.me/?text=${encodeURIComponent(shareText)}`;
  }, [shareText]);

  const handleToggleStep = (stepKey: string) => {
    setCompletedStepKeys((prev) =>
      prev.includes(stepKey)
        ? prev.filter((k) => k !== stepKey)
        : [...prev, stepKey]
    );
  };

  const handleCopySummary = async () => {
    if (!shareText) return;
    try {
      await navigator.clipboard.writeText(shareText);
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2500);
    } catch {
      // Clipboard might be unavailable in restricted contexts
    }
  };

  const filteredPublishedRoutes = useMemo(() => {
    const q = routeFilter.trim();
    if (!q) return routes;
    return routes.filter(
      (r) =>
        r.name.includes(q) ||
        r.direction.includes(q) ||
        r.stopNames.some((s) => s.includes(q))
    );
  }, [routes, routeFilter]);

  const handleSwap = () => {
    const prevOrigin = originId;
    onChangeOrigin(destinationId);
    onChangeDestination(prevOrigin);
    onSelectTrip(null);
  };

  const verifiedPlacesCount = places.length;
  const publishedRoutesCount = routes.length;
  const pendingCount = publicStats?.pendingSuggestionsCount ?? 56;
  const fieldCheckCount = publicStats?.fieldCheckCount ?? 4;

  const selectedOriginPlace = places.find((p) => p.id === originId);
  const selectedDestPlace = places.find((p) => p.id === destinationId);

  return (
    <section id="search-section" className="space-y-6 md:space-y-8">
      {/* Hero + Summary Strip */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 md:p-8">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold text-[#0B4F6C] mb-2">
            دليل المواصلات الذكي · الإسكندرية
          </p>
          <h1 className="text-2xl md:text-4xl font-extrabold text-[#0F172A] leading-tight mb-3">
            مسارات الإسكندرية المعتمدة وحاسبة الأجرة وخط السير
          </h1>
          <p className="text-sm md:text-base text-[#475569] leading-relaxed">
            ابحث عن خطوط الميكروباص والترام والسرفيس المعتمدة، وتابع محطاتك خطوة بخطوة مع حاسبة الأجرة التلقائية والعمل بدون إنترنت.
          </p>
        </div>

        {/* 4-column KPI strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6 pt-5 border-t border-[#E2E8F0]">
          <div>
            <p className="text-xs text-[#475569] mb-1">الأماكن الموثقة</p>
            <p className="text-2xl font-bold text-[#0F172A] font-mono-num tabular-nums">
              {verifiedPlacesCount}
            </p>
          </div>
          <div>
            <p className="text-xs text-[#475569] mb-1">الخطوط المنشورة</p>
            <p className="text-2xl font-bold text-[#0F172A] font-mono-num tabular-nums">
              {publishedRoutesCount}
            </p>
          </div>
          <div>
            <p className="text-xs text-[#475569] mb-1">مقترحات بانتظار التدقيق</p>
            <p className="text-2xl font-bold text-[#0B4F6C] font-mono-num tabular-nums">
              {pendingCount}
            </p>
          </div>
          <div>
            <p className="text-xs text-[#475569] mb-1">قيد التحقق الميداني</p>
            <p className="text-2xl font-bold text-[#D97706] font-mono-num tabular-nums">
              {fieldCheckCount}
            </p>
          </div>
        </div>
      </div>

      {/* Trip Search + Fare Calculator + Interactive Itinerary */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 bg-white border border-[#E2E8F0] rounded-2xl p-5 md:p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-[#0F172A] flex items-center gap-2">
              <Search className="w-5 h-5 text-[#0B4F6C]" />
              البحث عن رحلة موثقة
            </h2>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="تصفية حسب نطاق الإسكندرية"
                value={zoneFilter}
                onChange={(e) => setZoneFilter(e.target.value)}
                className="min-h-[44px] md:min-h-[36px] px-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-xs font-medium text-[#0F172A]"
              >
                <option value="all">كل نطاقات الإسكندرية</option>
                {ALEXANDRIA_ZONES.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={onNavigateAiAssistant}
                className="min-h-[44px] md:min-h-[36px] px-2.5 text-xs font-semibold text-[#0B4F6C] hover:underline cursor-pointer whitespace-nowrap"
              >
                اسأل المساعد الذكي
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-end">
            <div>
              <label
                htmlFor="origin-select"
                className="block text-xs font-semibold text-[#475569] mb-1.5"
              >
                نقطة الانطلاق (الموثقة فقط)
              </label>
              <select
                id="origin-select"
                value={originId}
                onChange={(e) => {
                  onChangeOrigin(e.target.value);
                  onSelectTrip(null);
                }}
                disabled={places.length === 0}
                className="w-full h-11 px-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0B4F6C] disabled:opacity-60"
              >
                <option value="">
                  {places.length === 0
                    ? 'لا توجد أماكن موثقة بعد'
                    : 'اختر نقطة الانطلاق...'}
                </option>
                {filteredPlacesForSelect.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.district} ({PLACE_CATEGORY_LABELS[p.category]})
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleSwap}
              disabled={!originId && !destinationId}
              title="تبديل الانطلاق والوجهة"
              aria-label="تبديل الانطلاق والوجهة"
              className="min-h-[44px] min-w-[44px] px-3 rounded-lg border border-[#E2E8F0] bg-white hover:bg-[#F1F5F9] text-[#475569] hover:text-[#0F172A] transition-colors flex items-center justify-center cursor-pointer disabled:opacity-50"
            >
              <ArrowLeftRight className="w-4 h-4" />
            </button>

            <div>
              <label
                htmlFor="dest-select"
                className="block text-xs font-semibold text-[#475569] mb-1.5"
              >
                وجهة الوصول (الموثقة فقط)
              </label>
              <select
                id="dest-select"
                value={destinationId}
                onChange={(e) => {
                  onChangeDestination(e.target.value);
                  onSelectTrip(null);
                }}
                disabled={places.length === 0}
                className="w-full h-11 px-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0B4F6C] disabled:opacity-60"
              >
                <option value="">
                  {places.length === 0
                    ? 'لا توجد أماكن موثقة بعد'
                    : 'اختر وجهة الوصول...'}
                </option>
                {filteredPlacesForSelect.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.district} ({PLACE_CATEGORY_LABELS[p.category]})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {(selectedOriginPlace?.landmarkHint || selectedDestPlace?.landmarkHint) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-[#475569]">
              {selectedOriginPlace?.landmarkHint && (
                <p>
                  <span className="font-semibold text-[#0F172A]">معلم الانطلاق:</span>{' '}
                  {selectedOriginPlace.landmarkHint}
                </p>
              )}
              {selectedDestPlace?.landmarkHint && (
                <p>
                  <span className="font-semibold text-[#0F172A]">معلم الوصول:</span>{' '}
                  {selectedDestPlace.landmarkHint}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-[#E2E8F0]">
            <div className="flex items-center gap-1 p-1 bg-[#F1F5F9] rounded-lg">
              <button
                type="button"
                onClick={() => setSortBy('fastest')}
                className={`min-h-[40px] md:min-h-[32px] px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  sortBy === 'fastest'
                    ? 'bg-white text-[#0F172A] shadow-sm'
                    : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                الأسرع وقتًا
              </button>
              <button
                type="button"
                onClick={() => setSortBy('cheapest')}
                className={`min-h-[40px] md:min-h-[32px] px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  sortBy === 'cheapest'
                    ? 'bg-white text-[#0F172A] shadow-sm'
                    : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                الأقل أجرة
              </button>
            </div>

            <span className="text-xs text-[#64748B]">
              تُحسب الأجرة تلقائيًا للراكب الفرد
            </span>
          </div>

          {/* Search Results / Public Empty State */}
          {places.length === 0 || routes.length === 0 ? (
            <div className="rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] p-5 space-y-3">
              <div className="flex items-center gap-2 text-[#0B4F6C] font-bold text-sm">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                الشبكة في طور التوثيق والتدقيق الذكي
              </div>
              <p className="text-sm text-[#475569] leading-relaxed">
                لا تُعرض الأماكن أو الخطوط في البحث العام إلا بعد اجتياز التقييم الذكي والمراجعة. توجد حاليًا{' '}
                <span className="font-bold text-[#0F172A] tabular-nums">
                  {pendingCount + fieldCheckCount}
                </span>{' '}
                نقطة وسوقًا قيد التدقيق في الإسكندرية ({pendingCount} بانتظار التدقيق و{fieldCheckCount} قيد التحقق الميداني).
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={onNavigateAiAssistant}
                  className="min-h-[44px] px-4 py-2 text-xs font-semibold text-white bg-[#0B4F6C] hover:bg-[#083B52] rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                >
                  اسأل المساعد الذكي
                </button>
                <button
                  type="button"
                  onClick={onNavigateContribute}
                  className="min-h-[44px] px-4 py-2 text-xs font-semibold text-[#0F172A] bg-white border border-[#E2E8F0] hover:bg-[#F1F5F9] rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                >
                  اقترح مكانًا أو مسارًا
                </button>
              </div>
            </div>
          ) : !originId || !destinationId ? (
            <div className="rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] p-5 text-sm text-[#475569]">
              اختر نقطة الانطلاق ووجهة الوصول من القائمة أو استخدم المساعد الذكي أعلاه لعرض الخطوط المباشرة والتبديلات الموثقة.
            </div>
          ) : originId === destinationId ? (
            <div className="rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] p-5 text-sm text-[#D97706] font-medium">
              نقطة الانطلاق والوجهة متطابقتان. يرجى اختيار محطة وصول مختلفة.
            </div>
          ) : tripResults.length === 0 ? (
            <div className="rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] p-5 space-y-2">
              <p className="text-sm font-bold text-[#0F172A]">
                لا يوجد خط مباشر أو تبديل واحد موثق بين النقطتين حاليًا
              </p>
              <p className="text-xs text-[#475569]">
                يمكنك اقتراح خط جديد يربط هذه الأماكن الموثقة عبر قسم المساهمة ليقيمه المدقق الذكي فورًا.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {tripResults.map((trip) => {
                const isSelected = activeTrip?.id === trip.id;
                const tripCalc = calculateTripFareAndTime(trip);
                return (
                  <button
                    key={trip.id}
                    type="button"
                    onClick={() => onSelectTrip(trip)}
                    className={`w-full min-h-[44px] text-right p-4 rounded-xl border transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-[#0B4F6C] bg-[#0B4F6C]/5'
                        : 'border-[#E2E8F0] bg-white hover:bg-[#F8FAFC]'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                      <span className="text-xs font-semibold text-[#0B4F6C]">
                        {trip.type === 'direct'
                          ? 'رحلة مباشرة بدون تبديل'
                          : `تبديل واحد عبر ${trip.transferPlace?.name}`}
                      </span>
                      <span className="text-xs text-[#475569] font-mono-num tabular-nums">
                        {tripCalc.farePerRider} ج.م للفرد · {trip.totalMinutes} دقيقة
                      </span>
                    </div>
                    <p className="text-sm font-bold text-[#0F172A] mb-1">
                      {trip.legs.map((l) => l.route.name).join(' ثم ')}
                    </p>
                    <p className="text-xs text-[#475569]">
                      {trip.legs
                        .map(
                          (l) =>
                            `${VEHICLE_TYPE_LABELS[l.route.vehicleType]}: ${l.fromPlace.name} ← ${l.toPlace.name}`
                        )
                        .join(' · ')}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Single-Rider Fare Breakdown + Interactive Step-by-Step Itinerary + WhatsApp Share */}
        <div className="lg:col-span-5 bg-white border border-[#E2E8F0] rounded-2xl p-5 md:p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-[#0F172A] flex items-center gap-2">
              <Calculator className="w-5 h-5 text-[#D97706]" />
              خط السير وحاسبة الأجرة
            </h2>
            {activeTrip && itinerarySteps.length > 0 && (
              <span className="text-xs text-[#475569] font-mono-num tabular-nums">
                {completedStepKeys.length} / {itinerarySteps.length} محطات
              </span>
            )}
          </div>

          {!activeTrip || !calculation ? (
            <div className="py-8 text-center space-y-2 border border-dashed border-[#E2E8F0] rounded-xl px-4">
              <Coins className="w-7 h-7 text-[#94A3B8] mx-auto" />
              <p className="text-sm font-semibold text-[#0F172A]">
                خط السير التفاعلي والأجرة سيظهران هنا
              </p>
              <p className="text-xs text-[#475569] leading-relaxed">
                عند اختيار رحلة موثقة، ستظهر أجرة الفرد، الوقت التقديري، تتبّع المحطات خطوة بخطوة، وزر مشاركة الرحلة عبر واتساب.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {/* 3-Column KPI */}
              <div className="grid grid-cols-3 gap-3 pb-4 border-b border-[#E2E8F0]">
                <div>
                  <p className="text-xs text-[#475569] mb-0.5">أجرة الفرد</p>
                  <p className="text-xl font-bold text-[#0F172A] font-mono-num tabular-nums">
                    {calculation.farePerRider} ج.م
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#475569] mb-0.5">الوقت التقديري</p>
                  <p className="text-xl font-bold text-[#0B4F6C] font-mono-num tabular-nums">
                    {calculation.totalMinutes} د
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#475569] mb-0.5">التبديلات</p>
                  <p className="text-xl font-bold text-[#D97706] font-mono-num tabular-nums">
                    {activeTrip.type === 'direct' ? '0' : '1'}
                  </p>
                </div>
              </div>

              {/* Legs Summary */}
              <div className="space-y-2">
                {activeTrip.legs.map((leg, idx) => (
                  <div
                    key={leg.route.id + idx}
                    className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] flex flex-wrap items-center justify-between gap-2"
                  >
                    <div>
                      <p className="text-xs font-bold text-[#0B4F6C]">
                        المرحلة {idx + 1} · {VEHICLE_TYPE_LABELS[leg.route.vehicleType]}
                      </p>
                      <p className="text-sm font-bold text-[#0F172A]">
                        {leg.route.name}
                      </p>
                    </div>
                    <span className="text-xs text-[#475569] font-mono-num tabular-nums">
                      {leg.fareEgp} ج.م · {leg.estimatedMinutes} دقيقة
                    </span>
                  </div>
                ))}
              </div>

              {/* Interactive Step-by-Step Stop Tracker */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-[#0F172A]">
                    اضغط على كل محطة لتعليمها أثناء الركوب:
                  </p>
                  {completedStepKeys.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setCompletedStepKeys([])}
                      className="min-h-[36px] px-2 text-[11px] font-semibold text-[#475569] hover:text-[#0F172A] inline-flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      إعادة ضبط
                    </button>
                  )}
                </div>

                <ol className="space-y-2">
                  {itinerarySteps.map((step) => {
                    const isDone = completedStepKeys.includes(step.stepKey);
                    return (
                      <li key={step.stepKey}>
                        <button
                          type="button"
                          onClick={() => handleToggleStep(step.stepKey)}
                          className={`w-full min-h-[44px] p-3 rounded-xl border text-right flex items-start gap-3 transition-colors cursor-pointer ${
                            isDone
                              ? 'border-[#16A34A]/40 bg-[#16A34A]/5'
                              : step.isTransferHandoff
                                ? 'border-[#D97706]/50 bg-[#D97706]/5'
                                : 'border-[#E2E8F0] bg-white hover:bg-[#F8FAFC]'
                          }`}
                        >
                          <span
                            className={`w-6 h-6 rounded-full text-xs font-mono-num tabular-nums flex items-center justify-center shrink-0 mt-0.5 border ${
                              isDone
                                ? 'bg-[#16A34A] border-[#16A34A] text-white'
                                : step.isTransferHandoff
                                  ? 'bg-[#D97706] border-[#D97706] text-white'
                                  : 'bg-[#F8FAFC] border-[#E2E8F0] text-[#0F172A]'
                            }`}
                          >
                            {isDone ? (
                              <Check className="w-3.5 h-3.5" />
                            ) : (
                              step.stepNumber
                            )}
                          </span>

                          <div className="flex-1 min-w-0">
                            <p
                              className={`text-sm font-bold ${
                                isDone
                                  ? 'line-through text-[#64748B]'
                                  : 'text-[#0F172A]'
                              }`}
                            >
                              {step.stop.name}
                            </p>
                            <p className="text-xs text-[#64748B]">
                              {step.stop.district}
                              {step.stop.landmarkHint
                                ? ` · ${step.stop.landmarkHint}`
                                : ''}
                            </p>
                            {step.isTransferHandoff && step.nextLeg && (
                              <p className="text-xs font-semibold text-[#D97706] mt-1">
                                نقطة التبديل: انزل هنا واركب {VEHICLE_TYPE_LABELS[step.nextLeg.route.vehicleType]} «{step.nextLeg.route.name}»
                              </p>
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ol>

                {activeTrip.type === 'transfer' && activeTrip.transferPlace && (
                  <p className="text-xs text-[#D97706] font-medium flex items-center gap-1.5 pt-1">
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                    يشمل الوقت {activeTrip.transferWaitMinutes} دقائق متوسط انتظار عند تبديل{' '}
                    {activeTrip.transferPlace.name}.
                  </p>
                )}
              </div>

              {/* One-Tap WhatsApp Share + Copy Summary */}
              <div className="pt-4 border-t border-[#E2E8F0] flex flex-wrap items-center gap-2.5">
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 min-h-[44px] px-4 py-2.5 rounded-lg bg-[#16A34A] hover:bg-[#15803D] text-white text-xs font-semibold transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap"
                >
                  <Share2 className="w-4 h-4 shrink-0" />
                  مشاركة الرحلة عبر واتساب
                </a>
                <button
                  type="button"
                  onClick={() => void handleCopySummary()}
                  className="min-h-[44px] px-3.5 py-2.5 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] hover:bg-[#F1F5F9] text-xs font-semibold text-[#0F172A] transition-colors inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Copy className="w-3.5 h-3.5 shrink-0" />
                  {copiedSummary ? 'تم النسخ' : 'نسخ الملخص'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Published Verified Routes Directory */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 md:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-[#0F172A] flex items-center gap-2">
              <RouteIcon className="w-4 h-4 text-[#0B4F6C]" />
              دليل الخطوط الموثقة المنشورة
            </h3>
            <p className="text-xs text-[#475569] mt-0.5">
              يتولد اسم كل خط واتجاهه تلقائيًا من أول وآخر نقطة موثقة.
            </p>
          </div>
          {routes.length > 0 && (
            <input
              type="search"
              value={routeFilter}
              onChange={(e) => setRouteFilter(e.target.value)}
              placeholder="ابحث باسم الخط أو المحطة..."
              className="h-11 md:h-9 w-full sm:w-64 px-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0B4F6C]"
            />
          )}
        </div>

        {filteredPublishedRoutes.length === 0 ? (
          <p className="text-sm text-[#475569] py-2">
            {routes.length === 0
              ? 'لم يتم نشر أي خطوط ثابتة بعد. بعد اعتماد الأماكن بالنظام الهجين، يمكن بناء ونشر الخطوط هنا.'
              : 'لا توجد خطوط مطابقة لعبارة البحث الحالية.'}
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPublishedRoutes.map((route) => (
              <div
                key={route.id}
                className="p-4 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] flex flex-col justify-between gap-3"
              >
                <div>
                  <p className="text-xs text-[#475569] font-mono-num tabular-nums mb-1">
                    {VEHICLE_TYPE_LABELS[route.vehicleType]} · {route.fareEgp} ج.م ·{' '}
                    {route.estimatedMinutes} د · {route.stopIds.length} محطات
                  </p>
                  <h4 className="text-sm font-bold text-[#0F172A]">{route.name}</h4>
                  <p className="text-xs text-[#475569] mt-1">{route.direction}</p>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-[#E2E8F0]">
                  <span className="text-xs text-[#64748B] truncate max-w-[180px]">
                    {route.stopNames.join(' ← ')}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onChangeOrigin(route.originPlaceId);
                      onChangeDestination(route.destinationPlaceId);
                      onSelectTrip(null);
                    }}
                    className="min-h-[44px] md:min-h-[32px] px-2 text-xs font-semibold text-[#0B4F6C] hover:underline cursor-pointer shrink-0 inline-flex items-center gap-1"
                  >
                    <MapPin className="w-3 h-3" />
                    تطبيق
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
