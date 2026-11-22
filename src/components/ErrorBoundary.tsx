import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  {children: React.ReactNode},
  ErrorBoundaryState
> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = {hasError: false, message: ''};
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'حدث خطأ غير متوقع في التطبيق.',
    };
  }

  componentDidCatch(error: Error) {
    console.error('Mashroei ErrorBoundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          dir="rtl"
          className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6"
        >
          <div className="max-w-lg w-full bg-white border border-[#E2E8F0] rounded-xl p-8 text-right">
            <p className="text-xs font-medium text-[#D97706] mb-2">
              تنبيه النظام
            </p>
            <h1 className="text-xl font-bold text-[#0F172A] mb-3">
              تعذر إتمام العملية الحالية
            </h1>
            <p className="text-sm text-[#475569] leading-relaxed mb-6 break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-[#0B4F6C] hover:bg-[#083B52] rounded-lg transition-colors cursor-pointer"
            >
              إعادة تحميل الصفحة
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
