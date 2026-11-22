import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import {fileURLToPath} from 'url';
import {createServer as createViteServer} from 'vite';
import {GoogleGenAI, ThinkingLevel, Type} from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const MODEL_ID = 'gemini-4-hydrogen';

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('GEMINI_API_KEY_MISSING');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 14000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isTransientAiError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return (
    raw.includes('503') ||
    raw.includes('UNAVAILABLE') ||
    raw.includes('429') ||
    raw.includes('RESOURCE_EXHAUSTED') ||
    raw.includes('500') ||
    raw.includes('502') ||
    raw.includes('504') ||
    raw.includes('ECONNRESET') ||
    raw.includes('ETIMEDOUT') ||
    raw.includes('AbortError') ||
    raw.includes('TimeoutError') ||
    raw.includes('timed out') ||
    raw.includes('aborted') ||
    raw.includes('fetch failed') ||
    raw.includes('high demand')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 3,
  deadlineMs = 24000
): Promise<{result: T; attempts: number; latencyMs: number}> {
  const startedAt = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await operation();
      return {
        result,
        attempts: attempt,
        latencyMs: Date.now() - startedAt,
      };
    } catch (err) {
      lastError = err;
      const elapsed = Date.now() - startedAt;
      if (attempt === maxAttempts || !isTransientAiError(err) || elapsed >= deadlineMs) {
        throw err;
      }
      const baseDelayMs = Math.min(3200, 800 * Math.pow(2, attempt - 1));
      const jitterMs = Math.floor(Math.random() * 350);
      await sleep(Math.min(baseDelayMs + jitterMs, Math.max(200, deadlineMs - elapsed)));
    }
  }

  throw lastError;
}

function formatAiHttpError(err: unknown): {
  status: number;
  code: string;
  retryable: boolean;
  message: string;
} {
  if (err instanceof Error && err.message === 'GEMINI_API_KEY_MISSING') {
    return {
      status: 503,
      code: 'GEMINI_API_KEY_MISSING',
      retryable: false,
      message:
        'مفتاح Gemini API غير مضبوط في إعدادات الخادم (GEMINI_API_KEY). يرجى إضافته من لوحة Secrets لتفعيل المساعد والمدقق الذكي.',
    };
  }
  const raw = err instanceof Error ? err.message : String(err);
  if (
    raw.includes('503') ||
    raw.includes('UNAVAILABLE') ||
    raw.includes('high demand')
  ) {
    return {
      status: 503,
      code: 'AI_UNAVAILABLE',
      retryable: true,
      message:
        'نموذج الذكاء الاصطناعي يواجه ضغطًا مؤقتًا حاليًا (503). تمت إعادة المحاولة تلقائيًا؛ يرجى الضغط على إعادة المحاولة خلال ثوانٍ.',
    };
  }
  if (
    raw.includes('AbortError') ||
    raw.includes('TimeoutError') ||
    raw.includes('timed out') ||
    raw.includes('504') ||
    raw.includes('aborted')
  ) {
    return {
      status: 504,
      code: 'AI_TIMEOUT',
      retryable: true,
      message:
        'تأخر رد خدمة الذكاء الاصطناعي عن المهلة المحددة (504). تم حفظ الدفعات السابقة ويمكنك إعادة محاولة المتبقي فورًا.',
    };
  }
  if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      code: 'AI_RATE_LIMITED',
      retryable: true,
      message:
        'تم تجاوز حد الطلبات المؤقت لخدمة الذكاء الاصطناعي (429). يرجى الانتظار قليلًا ثم إعادة المحاولة.',
    };
  }
  if (
    raw.includes('403') ||
    raw.includes('PERMISSION_DENIED') ||
    raw.includes('API_KEY_INVALID')
  ) {
    return {
      status: 502,
      code: 'AI_AUTH_ERROR',
      retryable: false,
      message:
        'تعذر التحقق من صلاحية مفتاح Gemini API على الخادم. يرجى مراجعة الإعدادات في Secrets.',
    };
  }
  return {
    status: 500,
    code: 'AI_REQUEST_FAILED',
    retryable: isTransientAiError(err),
    message: `تعذر إتمام الطلب عبر الذكاء الاصطناعي: ${raw}`,
  };
}

function safeParseJson<T>(rawText: string | undefined, fallback: T): T {
  const trimmed = (rawText ?? '').trim();
  if (!trimmed) return fallback;
  const cleaned = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(cleaned) as T;
}

interface CompactPlaceInput {
  id: string;
  name: string;
  category: string;
  district: string;
  landmarkHint?: string;
}

interface CompactRouteInput {
  id: string;
  name: string;
  direction: string;
  stopIds: string[];
  stopNames: string[];
  fareEgp: number;
  estimatedMinutes: number;
  vehicleType: string;
  notes?: string;
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  app.use(express.json({limit: '2mb'}));

  app.get('/api/health', (_req, res) => {
    res.json({status: 'ok', model: MODEL_ID});
  });

  // 1. AI Trip Assistant grounded strictly in verified places & routes
  app.post('/api/ai/trip-assistant', async (req, res) => {
    try {
      const {question, places = [], routes = [], pendingSuggestionsCount = 0} =
        req.body as {
          question?: string;
          places?: CompactPlaceInput[];
          routes?: CompactRouteInput[];
          pendingSuggestionsCount?: number;
        };

      if (!question || typeof question !== 'string' || !question.trim()) {
        res.status(400).json({error: 'يرجى كتابة سؤالك عن الرحلة أو الوجهة أولًا.'});
        return;
      }

      const ai = getAiClient();

      const placesContext = places.slice(0, 120).map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        district: p.district,
        landmarkHint: p.landmarkHint || '',
      }));

      const routesContext = routes.slice(0, 120).map((r) => ({
        id: r.id,
        name: r.name,
        direction: r.direction,
        stopIds: r.stopIds,
        stopNames: r.stopNames,
        fareEgp: r.fareEgp,
        estimatedMinutes: r.estimatedMinutes,
        vehicleType: r.vehicleType,
        notes: r.notes || '',
      }));

      const {result: response} = await generateWithRetry(() =>
        ai.models.generateContent({
          model: MODEL_ID,
          contents: JSON.stringify({
            userQuestion: question.trim(),
            verifiedPlacesCount: placesContext.length,
            publishedRoutesCount: routesContext.length,
            pendingSuggestionsCount,
            verifiedPlaces: placesContext,
            publishedRoutes: routesContext,
          }),
          config: {
            thinkingConfig: {thinkingLevel: ThinkingLevel.LOW},
            systemInstruction:
              'أنت مساعد رحلات ذكي متخصص في مواصلات الإسكندرية لتطبيق «مشروعي». ' +
              'القواعد الصارمة:\n' +
              '1) اعتمد حصريًا على الأماكن الموثقة (verifiedPlaces) والخطوط المنشورة (publishedRoutes) المرسلة لك في البيانات. يُمنع منعًا باتًا اختراع خطوط أو تسعيرات أو أرقام ميكروباصات غير موجودة في publishedRoutes.\n' +
              '2) افهم العامية المصرية والإسكندرانية (مثل: "عايز أروح من سيدي جابر للمنشية"، "أركب إيه من العجمي لمحطة الرمل"، "أقرب سوق في وسط البلد").\n' +
              '3) إذا وجدت مكان انطلاق ووصول مطابقين داخل verifiedPlaces فأعد معرّفاتهما في matchedOriginId وmatchedDestinationId واشرح المسار المباشر أو التبديل من publishedRoutes والأجرة والزمن التقديري.\n' +
              '4) إذا كانت الأماكن الموثقة أو الخطوط المنشورة فارغة أو لا تغطي الطلب بعد، فصرّح بوضوح وأمانة أن الشبكة لا تزال قيد التوثيق (مع ذكر عدد المقترحات المنتظرة للمراجعة إن وجد)، واقترح استخدام قسم المساهمة لاقتراح المسار.\n' +
              '5) اكتب الإجابة بالعربية الواضحة المختصرة.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                replyArabic: {
                  type: Type.STRING,
                  description: 'الشرح الوافي للمستخدم باللغة العربية استنادًا للبيانات الموثقة فقط.',
                },
                matchedOriginId: {
                  type: Type.STRING,
                  description: 'معرّف نقطة الانطلاق المطابقة من verifiedPlaces أو سلسلة فارغة إذا لم يتحدد.',
                },
                matchedDestinationId: {
                  type: Type.STRING,
                  description: 'معرّف وجهة الوصول المطابقة من verifiedPlaces أو سلسلة فارغة إذا لم يتحدد.',
                },
                estimatedSummary: {
                  type: Type.STRING,
                  description: 'ملخص قصير للأجرة والزمن وعدد التبديلات أو حالة التوفر.',
                },
                confidenceNote: {
                  type: Type.STRING,
                  description: 'تنويه قصير حول مستوى التوثيق أو سبب عدم توفر خط منشور.',
                },
              },
              required: [
                'replyArabic',
                'matchedOriginId',
                'matchedDestinationId',
                'estimatedSummary',
                'confidenceNote',
              ],
            },
          },
        })
      );

      const parsed = safeParseJson<Record<string, unknown>>(response.text, {});
      res.json(parsed);
    } catch (err) {
      const mapped = formatAiHttpError(err);
      res.status(mapped.status).json({
        error: mapped.message,
        code: mapped.code,
        retryable: mapped.retryable,
      });
    }
  });

  // 2. Single Suggestion Evaluator (Place or Route)
  app.post('/api/ai/evaluate-suggestion', async (req, res) => {
    try {
      const {kind = 'place', item, existingNames = []} = req.body as {
        kind?: 'place' | 'route';
        item?: Record<string, unknown>;
        existingNames?: string[];
      };

      if (!item) {
        res.status(400).json({error: 'بيانات المقترح مطلوبة للتقييم.'});
        return;
      }

      const ai = getAiClient();
      const {result: response, attempts, latencyMs} = await generateWithRetry(() =>
        ai.models.generateContent({
          model: MODEL_ID,
          contents: JSON.stringify({
            kind,
            item,
            existingVerifiedNames: existingNames.slice(0, 150),
          }),
          config: {
            thinkingConfig: {thinkingLevel: ThinkingLevel.LOW},
            systemInstruction:
              'أنت مدقق بيانات جغرافية ومواصلات للإسكندرية في نظام الاعتماد الهجين بتطبيق «مشروعي».\n' +
              'قيّم المقترح وفق المعايير التالية:\n' +
              '- للنقاط والأماكن (place): هل الاسم حقيقي ومعروف في الإسكندرية؟ هل النطاق الجغرافي صحيح (شرق الإسكندرية / وسط الإسكندرية / غرب الإسكندرية / العامرية وبرج العرب)؟ هل التصنيف (neighborhood / pickup_point / market / historical_stand) مناسب؟ وهل يوجد معلم مميز أو وصف واضح وليس مكررًا مع existingVerifiedNames؟\n' +
              '- للخطوط (route): هل تسلسل المحطات منطقي جغرافيًا في الإسكندرية وهل الأجرة (بالجنيه) والمدة (بالدقائق) واقعيتان لنوع المركبة؟\n' +
              '- قرار الاعتماد الهجين (verdict):\n' +
              '  * auto_approve (ثقة >= 80): معلم/حي/سوق أو موقف مشهور ومعروف بدقة، ولا يتعارض مع الأسماء الموجودة.\n' +
              '  * field_check (ثقة 50-79): نقطة غير محددة المعالم بدقة، أو موقف تاريخي/فرعي يحتاج معاينة رصيف ميدانية، أو أجرة غير واضحة.\n' +
              '  * needs_review (ثقة < 50): بيانات ناقصة، غامضة، مكررة بوضوح، أو خارج نطاق الإسكندرية.\n' +
              'أرجع JSON دقيقًا بالعربية.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                confidence: {
                  type: Type.INTEGER,
                  description: 'نسبة الثقة من 0 إلى 100.',
                },
                verdict: {
                  type: Type.STRING,
                  description: 'واحد من: auto_approve أو field_check أو needs_review.',
                },
                normalizedDistrict: {
                  type: Type.STRING,
                  description: 'النطاق الإسكندراني الأنسب.',
                },
                suggestedCategory: {
                  type: Type.STRING,
                  description: 'التصنيف المقترح: neighborhood أو pickup_point أو market أو historical_stand.',
                },
                reasoning: {
                  type: Type.STRING,
                  description: 'سبب مختصر واضح بالعربية (بحد أقصى 220 حرفًا).',
                },
              },
              required: [
                'confidence',
                'verdict',
                'normalizedDistrict',
                'suggestedCategory',
                'reasoning',
              ],
            },
          },
        })
      );

      const parsed = safeParseJson<Record<string, unknown>>(response.text, {});
      const confidence = Math.min(100, Math.max(0, Math.round(Number(parsed.confidence ?? 50))));
      const rawVerdict = String(parsed.verdict ?? 'needs_review');
      const verdict =
        rawVerdict === 'auto_approve' && confidence >= 80
          ? 'auto_approve'
          : rawVerdict === 'field_check' || (confidence >= 50 && confidence < 80)
            ? 'field_check'
            : 'needs_review';

      res.json({
        confidence,
        verdict,
        normalizedDistrict: String(parsed.normalizedDistrict || ''),
        suggestedCategory: String(parsed.suggestedCategory || 'pickup_point'),
        reasoning: String(parsed.reasoning || 'تم التقييم بواسطة المدقق الذكي.').slice(0, 480),
        attempts,
        latencyMs,
      });
    } catch (err) {
      const mapped = formatAiHttpError(err);
      res.status(mapped.status).json({
        error: mapped.message,
        code: mapped.code,
        retryable: mapped.retryable,
      });
    }
  });

  // 3. Batch Hybrid Auditor for pending & field_check suggestions (fast 10-item chunks + retry)
  app.post('/api/ai/audit-batch', async (req, res) => {
    try {
      const {items = [], existingVerifiedNames = []} = req.body as {
        items?: Array<{
          id: string;
          name: string;
          category: string;
          district: string;
          landmarkHint?: string;
          sourceReference?: string;
          fieldNotes?: string;
        }>;
        existingVerifiedNames?: string[];
      };

      if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({error: 'لا توجد مقترحات مرسلة للتدقيق.'});
        return;
      }

      const ai = getAiClient();
      const chunkSize = 10;
      const allResults: Array<{
        id: string;
        confidence: number;
        verdict: 'auto_approve' | 'field_check' | 'needs_review';
        reasoning: string;
      }> = [];
      let totalAttempts = 0;
      const startedAt = Date.now();

      for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize).map((it) => ({
          id: it.id,
          name: it.name,
          category: it.category,
          district: it.district,
          landmarkHint: it.landmarkHint || '',
          sourceReference: it.sourceReference || '',
          fieldNotes: it.fieldNotes || '',
        }));
        const expectedIds = new Set(chunk.map((c) => c.id));

        const {result: response, attempts} = await generateWithRetry(() =>
          ai.models.generateContent({
            model: MODEL_ID,
            contents: JSON.stringify({
              existingVerifiedNames: existingVerifiedNames.slice(0, 150),
              suggestionsToAudit: chunk,
            }),
            config: {
              thinkingConfig: {thinkingLevel: ThinkingLevel.LOW},
              systemInstruction:
                'أنت المدقق الذكي لنظام الاعتماد الهجين في تطبيق «مشروعي» لمواصلات الإسكندرية.\n' +
                'لكل عنصر في suggestionsToAudit، قيّم موثوقيته الجغرافية ووضوح معالمه في الإسكندرية:\n' +
                '- auto_approve (ثقة 80-98): الأحياء السكنية المعروفة، الأسواق الشهيرة، والمواقف/المحطات الكبرى المعروفة ذات الوصف الواضح وغير المكررة في existingVerifiedNames.\n' +
                '- field_check (ثقة 50-79): المواقف التاريخية المتغيرة مروريًا (historical_stand) أو النقاط التي تنص ملاحظاتها على الحاجة لتأكيد موقع الرصيف أو حدود التحميل.\n' +
                '- needs_review (ثقة < 50): الأسماء المكررة أو غير الواضحة أو خارج الإسكندرية.\n' +
                'أعد مصفوفة كاملة مطابقة لكل عنصر في suggestionsToAudit مع نفس id تمامًا، وreasoning عربي موجز ومفيد.',
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: {type: Type.STRING},
                    confidence: {type: Type.INTEGER},
                    verdict: {type: Type.STRING},
                    reasoning: {type: Type.STRING},
                  },
                  required: ['id', 'confidence', 'verdict', 'reasoning'],
                },
              },
            },
          })
        );

        totalAttempts += attempts;
        const parsed = safeParseJson<Array<Record<string, unknown>>>(response.text, []);
        if (Array.isArray(parsed)) {
          for (const row of parsed) {
            const rowId = String(row.id ?? '');
            if (!expectedIds.has(rowId)) continue;
            const confidence = Math.min(
              100,
              Math.max(0, Math.round(Number(row.confidence ?? 50)))
            );
            const rawVerdict = String(row.verdict ?? 'needs_review');
            const verdict: 'auto_approve' | 'field_check' | 'needs_review' =
              rawVerdict === 'auto_approve' && confidence >= 80
                ? 'auto_approve'
                : rawVerdict === 'field_check' || (confidence >= 50 && confidence < 80)
                  ? 'field_check'
                  : 'needs_review';
            allResults.push({
              id: rowId,
              confidence,
              verdict,
              reasoning: String(row.reasoning ?? 'تم التقييم الهجين.').slice(0, 480),
            });
          }
        }
      }

      res.json({
        results: allResults,
        attempts: totalAttempts,
        latencyMs: Date.now() - startedAt,
      });
    } catch (err) {
      const mapped = formatAiHttpError(err);
      res.status(mapped.status).json({
        error: mapped.message,
        code: mapped.code,
        retryable: mapped.retryable,
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: {server: httpServer},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Mashroei server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
