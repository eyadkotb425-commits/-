import React, {useMemo, useState} from 'react';
import {ArrowDown, ArrowUp, Plus, Search, Trash2} from 'lucide-react';
import {
  PLACE_CATEGORY_LABELS,
  SCHEMA_LIMITS,
  VerifiedPlace,
} from '../types/transit';
import {generateRouteMeta} from '../lib/routing';

interface RouteBuilderControlProps {
  verifiedPlaces: VerifiedPlace[];
  selectedStops: VerifiedPlace[];
  onChangeStops: (stops: VerifiedPlace[]) => void;
}

export const RouteBuilderControl: React.FC<RouteBuilderControlProps> = ({
  verifiedPlaces,
  selectedStops,
  onChangeStops,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const availablePlaces = useMemo(() => {
    const selectedIds = new Set(selectedStops.map((s) => s.id));
    const q = searchTerm.trim();
    return verifiedPlaces.filter((p) => {
      if (!p.isActive || selectedIds.has(p.id)) return false;
      if (!q) return true;
      return p.name.includes(q) || p.district.includes(q);
    });
  }, [verifiedPlaces, selectedStops, searchTerm]);

  const {name, direction} = useMemo(
    () => generateRouteMeta(selectedStops),
    [selectedStops]
  );

  const addStop = (place: VerifiedPlace) => {
    if (selectedStops.length >= SCHEMA_LIMITS.MAX_STOPS) return;
    onChangeStops([...selectedStops, place]);
  };

  const removeStop = (index: number) => {
    const next = [...selectedStops];
    next.splice(index, 1);
    onChangeStops(next);
  };

  const moveStop = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= selectedStops.length) return;
    const next = [...selectedStops];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChangeStops(next);
  };

  if (verifiedPlaces.length < 2) {
    return (
      <div className="p-4 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-sm text-[#475569]">
        يتطلب بناء أو اقتراح خط وجود نقطتين موثقتين على الأقل في قاعدة البيانات. عدد الأماكن الموثقة حاليًا:{' '}
        <span className="font-bold text-[#0F172A] tabular-nums">
          {verifiedPlaces.length}
        </span>
        .
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] space-y-1">
        <p className="text-xs font-semibold text-[#0B4F6C]">
          الاسم والاتجاه المتولدان تلقائيًا من أول وآخر نقطة:
        </p>
        <p className="text-sm font-bold text-[#0F172A]">
          {name || 'أضف نقطتين موثقتين على الأقل لتوليد اسم الخط'}
        </p>
        {direction && <p className="text-xs text-[#475569]">{direction}</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Search Verified Places */}
        <div className="border border-[#E2E8F0] rounded-lg p-3 space-y-2.5 bg-white">
          <div className="relative">
            <Search className="w-4 h-4 text-[#64748B] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="ابحث في الأماكن الموثقة لإضافتها..."
              className="w-full h-10 pr-9 pl-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0B4F6C]"
            />
          </div>
          <div className="max-h-56 overflow-y-auto divide-y divide-[#E2E8F0]">
            {availablePlaces.length === 0 ? (
              <p className="text-xs text-[#64748B] py-4 text-center">
                لا توجد نقاط موثقة متاحة مطابقة.
              </p>
            ) : (
              availablePlaces.map((place) => (
                <div
                  key={place.id}
                  className="py-2 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#0F172A] truncate">
                      {place.name}
                    </p>
                    <p className="text-[11px] text-[#64748B] truncate">
                      {PLACE_CATEGORY_LABELS[place.category]} · {place.district}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => addStop(place)}
                    disabled={selectedStops.length >= SCHEMA_LIMITS.MAX_STOPS}
                    className="min-h-[36px] px-3 py-1.5 text-xs font-semibold text-[#0B4F6C] bg-[#0B4F6C]/10 hover:bg-[#0B4F6C]/20 rounded-md cursor-pointer shrink-0 inline-flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    إضافة
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Ordered Selected Stops */}
        <div className="border border-[#E2E8F0] rounded-lg p-3 space-y-2 bg-white">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-[#0F172A]">
              ترتيب نقاط المسار
            </span>
            <span className="text-[#475569] font-mono-num tabular-nums">
              {selectedStops.length} / {SCHEMA_LIMITS.MAX_STOPS}
            </span>
          </div>
          {selectedStops.length === 0 ? (
            <p className="text-xs text-[#64748B] py-8 text-center">
              اختر النقاط بالترتيب من القائمة المجاورة (من نقطة البداية إلى النهاية).
            </p>
          ) : (
            <ol className="max-h-56 overflow-y-auto divide-y divide-[#E2E8F0]">
              {selectedStops.map((stop, idx) => (
                <li
                  key={stop.id}
                  className="py-2 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-5 h-5 rounded-full bg-[#F1F5F9] text-[11px] font-bold font-mono-num tabular-nums flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[#0F172A] truncate">
                        {stop.name}
                      </p>
                      <p className="text-[11px] text-[#64748B]">
                        {idx === 0
                          ? 'نقطة البداية'
                          : idx === selectedStops.length - 1
                            ? 'نقطة النهاية'
                            : 'نقطة وسطية'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => moveStop(idx, -1)}
                      disabled={idx === 0}
                      aria-label="تحريك لأعلى"
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center text-[#475569] hover:text-[#0F172A] disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveStop(idx, 1)}
                      disabled={idx === selectedStops.length - 1}
                      aria-label="تحريك لأسفل"
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center text-[#475569] hover:text-[#0F172A] disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeStop(idx)}
                      aria-label="إزالة"
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center text-[#DC2626] hover:bg-[#DC2626]/10 rounded cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
};
