import React from 'react';
import {WifiOff} from 'lucide-react';
import {useOnlineStatus} from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC<{cachedPlacesCount?: number}> = ({
  cachedPlacesCount = 0,
}) => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl bg-[#D97706]/10 border border-[#D97706]/30 px-4 py-3 text-xs text-[#92400E] flex flex-wrap items-center justify-between gap-2"
    >
      <div className="flex items-center gap-2 font-semibold">
        <WifiOff className="w-4 h-4 shrink-0 text-[#D97706]" />
        <span>
          أنت في وضع عدم الاتصال بالإنترنت · تُعرض الأماكن والخطوط المحفوظة محليًا
          {cachedPlacesCount > 0 ? ` (${cachedPlacesCount} مكانًا)` : ''}
        </span>
      </div>
      <span className="text-[11px] text-[#78350F]">
        المساعد الذكي وإرسال المقترحات يحتاجان اتصالًا بالشبكة
      </span>
    </div>
  );
};
