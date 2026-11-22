import React, {useState} from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Send,
  Sparkles,
} from 'lucide-react';
import {VerifiedPlace, VerifiedRoute} from '../types/transit';
import {askAiTripAssistant, TripAssistantResponse} from '../lib/aiApi';

interface AiTripAssistantProps {
  places: VerifiedPlace[];
  routes: VerifiedRoute[];
  pendingTotalCount: number;
  onApplyMatchedRoute: (originId: string, destinationId: string) => void;
}

const SAMPLE_PROMPTS = [
  'عايز أروح من سيدي جابر لمحطة الرمل بأقل أجرة',
  'إزاي أوصل من الموقف الجديد للعجمي الهانوفيل؟',
  'أقرب خطوط موثقة لأسواق وسط البلد والمنشية',
];

export const AiTripAssistant: React.FC<AiTripAssistantProps> = ({
  places,
  routes,
  pendingTotalCount,
  onApplyMatchedRoute,
}) => {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<TripAssistantResponse | null>(null);

  const runQuery = async (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setLoading(true);
    setError(null);
    try {
      const res = await askAiTripAssistant({
        question: clean,
        places,
        routes,
        pendingSuggestionsCount: pendingTotalCount,
      });
      setAnswer(res);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'تعذر التواصل مع مساعد الرحلات الذكي حاليًا.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runQuery(question);
  };

  const matchedOrigin = answer?.matchedOriginId
    ? places.find((p) => p.id === answer.matchedOriginId)
    : undefined;
  const matchedDest = answer?.matchedDestinationId
    ? places.find((p) => p.id === answer.matchedDestinationId)
    : undefined;

  return (
    <section
      id="ai-assistant-section"
      className="bg-white border border-[#E2E8F0] rounded-xl p-6 md:p-8 space-y-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold text-[#0B4F6C] mb-1 inline-flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            مساعد رحلات ذكي · مقيد بالبيانات الموثقة فقط
          </p>
          <h2 className="text-xl font-bold text-[#0F172A]">
            اسأل عن رحلتك في الإسكندرية باللهجة المصرية أو الفصحى
          </h2>
          <p className="text-xs md:text-sm text-[#475569] mt-1 leading-relaxed">
            يفهم المساعد طلبك الحر ويقترح الخطوط والتبديلات والأجرة من قاعدة البيانات المعتمدة فقط دون أي تخمين.
          </p>
        </div>

        <p className="text-xs text-[#475569] font-mono-num tabular-nums">
          نطاق التحليل: {places.length} مكان موثق · {routes.length} خط منشور
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {SAMPLE_PROMPTS.map((sample) => (
          <button
            key={sample}
            type="button"
            disabled={loading}
            onClick={() => {
              setQuestion(sample);
              void runQuery(sample);
            }}
            className="min-h-[44px] md:min-h-[34px] px-3 py-2 text-xs text-right text-[#475569] hover:text-[#0F172A] bg-[#F8FAFC] hover:bg-[#F1F5F9] border border-[#E2E8F0] rounded-lg transition-colors cursor-pointer disabled:opacity-60"
          >
            {sample}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="اكتب وجهتك مثل: عايز أروح من فيكتوريا لمحطة الرمل بأقل وقت..."
          className="flex-1 h-11 px-4 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0B4F6C]"
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="min-h-[44px] h-11 px-5 rounded-lg bg-[#0B4F6C] hover:bg-[#083B52] text-white text-sm font-semibold transition-colors inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shrink-0"
        >
          <Send className="w-4 h-4" />
          {loading ? 'جارٍ التحليل...' : 'اسأل المساعد'}
        </button>
      </form>

      {error && (
        <div className="p-4 rounded-lg bg-[#DC2626]/5 border border-[#DC2626]/30 text-xs text-[#991B1B] flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#DC2626]" />
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div className="p-5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-2 animate-pulse">
          <div className="h-3 bg-[#E2E8F0] rounded w-1/3" />
          <div className="h-3 bg-[#E2E8F0] rounded w-5/6" />
          <div className="h-3 bg-[#E2E8F0] rounded w-2/3" />
        </div>
      )}

      {!loading && answer && (
        <div className="p-5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-[#0B4F6C]">
              <Bot className="w-4 h-4" />
              إجابة المساعد الذكي
            </div>
            {answer.estimatedSummary && (
              <span className="text-xs font-semibold text-[#0F172A] font-mono-num tabular-nums">
                {answer.estimatedSummary}
              </span>
            )}
          </div>

          <p className="text-sm text-[#0F172A] leading-relaxed whitespace-pre-line">
            {answer.replyArabic}
          </p>

          <div className="pt-3 border-t border-[#E2E8F0] flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-[#475569]">{answer.confidenceNote}</p>

            {(matchedOrigin || matchedDest) && (
              <button
                type="button"
                onClick={() =>
                  onApplyMatchedRoute(
                    matchedOrigin?.id ?? '',
                    matchedDest?.id ?? ''
                  )
                }
                className="min-h-[44px] md:min-h-[34px] px-3.5 py-2 rounded-lg bg-white border border-[#0B4F6C] text-xs font-semibold text-[#0B4F6C] hover:bg-[#0B4F6C] hover:text-white transition-colors inline-flex items-center gap-1.5 cursor-pointer"
              >
                تطبيق في الحاسبة
                {matchedOrigin && matchedDest
                  ? ` (${matchedOrigin.name} ← ${matchedDest.name})`
                  : ''}
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
