/**
 * i18n 的 React 绑定(薄壳): LangProvider 持 language state(初值 = 模块级当前语言),
 * useLang() 返回 { lang, setLang, t } —— setLang 切模块级语言 + 落盘, state 变更触发
 * Provider 子树整体重渲染, 各处 t() 在渲染时重读当前语言, 组件无需逐个改造。
 *
 * 与 i18n.ts 分文件的原因: 主进程(托盘菜单文案, Phase B)复用 i18n.ts 时零 react 依赖,
 * 不把 react 拖进主进程 bundle。
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { getLang, setLang as persistLang, LANGS, type Lang } from "./i18n";

interface LangCtx {
  lang: Lang;
  /** 切语言: 内存态 + localStorage 持久化(真壳 settings.json 持久化由 ipc 层 setLangPersisted 另落) */
  setLang: (l: Lang) => void;
  langs: readonly Lang[];
}

const Ctx = createContext<LangCtx | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => getLang());
  const setLang = useCallback((l: Lang) => {
    persistLang(l); // 模块级当前语言 + localStorage(隐私模式仅内存)
    setLangState(l); // 触发子树重渲染
  }, []);
  const value = useMemo<LangCtx>(() => ({ lang, setLang, langs: LANGS }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** 语言订阅: 未包 Provider 时(主进程/单测)退化为读模块级当前语言, 不挂 context 也能 t() */
export function useLang(): LangCtx {
  const ctx = useContext(Ctx);
  if (ctx) return ctx;
  // 兜底: 无 Provider(纯函数场景) — setLang no-op state(渲染时重读)
  return { lang: getLang(), setLang: persistLang, langs: LANGS };
}
