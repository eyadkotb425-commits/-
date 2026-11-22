import React from 'react';
import {AlertTriangle, BookOpen, FileCheck2, Sparkles} from 'lucide-react';
import {PublicStats} from '../types/transit';

interface SourcesSectionProps {
  publicStats: PublicStats | null;
  verifiedPlacesCount: number;
  publishedRoutesCount: number;
}

export const SourcesSection: React.FC<SourcesSectionProps> = ({
  publicStats,
  verifiedPlacesCount,
  publishedRoutesCount,
}) => {
  return (
    <section
      id="sources-section"
      className="bg-white border border-[#E2E8F0] rounded-xl p-6 md:p-8 space-y-6"
    >
      <div className="max-w-3xl">
        <p className="text-xs font-semibold text-[#0B4F6C] mb-1.5">
          سجل المصادر وضوابط التوثيق · ALEXANDRIA-PLACE-SOURCES
        </p>
        <h2 className="text-xl font-bold text-[#0F172A] flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-[#0B4F6C]" />
          منهجية توثيق الـ 60 منطقة وموقفًا ونظام الاعتماد الهجين
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-2">
          <div className="flex items-center gap-2 text-sm font-bold text-[#0F172A]">
            <Sparkles className="w-4 h-4 text-[#0B4F6C]" />
            نظام الاعتماد الهجين بالذكاء الاصطناعي
          </div>
          <p className="text-xs text-[#475569] leading-relaxed">
            يقيّم المدقق الذكي كل مقترح بنسبة ثقة (<span className="font-mono-num">0–100%</span>): تُنشر النقاط الموثوقة (80%+) تلقائيًا في الدليل، بينما تُوجَّه النقاط الغامضة للمراجعة البشرية أو التحقق الميداني. الأماكن المعتمدة حاليًا:{' '}
            <span className="font-bold text-[#0F172A] tabular-nums">{verifiedPlacesCount}</span>{' '}
            والخطوط المنشورة:{' '}
            <span className="font-bold text-[#0F172A] tabular-nums">{publishedRoutesCount}</span>.
          </p>
        </div>

        <div className="p-5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-2">
          <div className="flex items-center gap-2 text-sm font-bold text-[#0F172A]">
            <AlertTriangle className="w-4 h-4 text-[#D97706]" />
            نطاق القائمة الموسّعة (60 مقترحًا)
          </div>
          <p className="text-xs text-[#475569] leading-relaxed">
            تشمل القائمة الأولية 18 حيًا سكنيًا، 27 نقطة ركوب وموقف خدمة، 11 سوقًا، و4 مواقف تاريخية كبرى بحالة <span className="font-mono-num">field_check</span> تغطي شرق ووسط وغرب الإسكندرية والعامرية وبرج العرب.
          </p>
        </div>

        <div className="p-5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-2">
          <div className="flex items-center gap-2 text-sm font-bold text-[#0F172A]">
            <FileCheck2 className="w-4 h-4 text-[#0B4F6C]" />
            حالة قائمة المراجعة الحالية
          </div>
          <p className="text-xs text-[#475569] leading-relaxed">
            بانتظار التدقيق:{' '}
            <span className="font-bold text-[#0F172A] tabular-nums">
              {publicStats?.pendingSuggestionsCount ?? 56}
            </span>
            <span className="mx-1.5" aria-hidden="true">·</span>
            تحقق ميداني:{' '}
            <span className="font-bold text-[#D97706] tabular-nums">
              {publicStats?.fieldCheckCount ?? 4}
            </span>
            . يتم تحديث الإحصاءات تلقائيًا فور تشغيل التدقيق الهجين أو اعتماد أي مقترح.
          </p>
        </div>
      </div>
    </section>
  );
};
