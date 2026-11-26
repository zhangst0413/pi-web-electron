"use client";

import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { translateMessage } from "@/lib/i18n/format";
import { zhCNLocale } from "@/lib/i18n/messages/zh-CN";
import type { Locale, TranslationParams } from "@/lib/i18n/types";

const locale: Locale = "zh-CN";
const messages = { "zh-CN": zhCNLocale.messages };

interface I18nContextValue {
  locale: Locale;
  t: (key: string, params?: TranslationParams) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * 提供 Pi Web 的界面语言状态和翻译能力。界面只提供简体中文。
 * @param props React 子节点
 * @returns 包含语言上下文的 React 节点
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = locale;
  }, []);

  const t = useCallback((key: string, params?: TranslationParams) => translateMessage(locale, key, messages, params), []);
  const value = useMemo(() => ({ locale, t }), [t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * 获取当前组件树中的国际化能力。
 * @returns 当前 locale 和翻译函数
 * @throws 当组件不在 I18nProvider 内时抛出异常
 */
export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
