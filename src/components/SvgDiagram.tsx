import { useMemo, useState } from "react";
import { Check, Copy, WrapText, X } from "lucide-react";
import { useCopyFeedback } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { useAdvancedMode } from "@/lib/interface-mode";
import { CodeBlock, CodePlate } from "./CodeBlock";

/** Security: SVG is loaded exclusively via `<img src="data:image/svg+xml,…">`, where browsers never execute scripts or external resources. */
export function SvgDiagram({ code }: { code: string }) {
  const [showSource, setShowSource] = useState(false);
  const { state: copied, copy } = useCopyFeedback(code);
  const simple = !useAdvancedMode();
  const dataUrl = useMemo(() => {
    const trimmed = code.trim();
    if (!/^<svg[\s>]/i.test(trimmed)) return null;
    const withXmlns = /\bxmlns\s*=/i.test(trimmed)
      ? trimmed
      : trimmed.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(withXmlns)}`;
  }, [code]);

  if (!dataUrl) return <CodeBlock code={code} lang="svg" />;

  const visual = (
    <>
      <div data-stream-fade className="flex justify-center overflow-x-auto p-3">
        <img src={dataUrl} alt="SVG graphic" className="max-h-[480px] max-w-full rounded" />
      </div>
      {showSource && (
        <pre className={cn("overflow-x-auto text-[13px]", simple ? "px-3 py-2 leading-5 text-ink-secondary" : "p-3 leading-relaxed text-ink")}>{code}</pre>
      )}
    </>
  );

  if (simple) {
    return (
      <div dir="ltr" className="group/code relative my-2.5 overflow-hidden rounded-xl bg-ink/[0.04]">
        <CodePlate copied={copied} onCopy={copy} copyLabel={t("code.copySource")} items={[
          { key: "source", label: t(showSource ? "code.hideSource" : "code.showSource"), icon: <WrapText size={14} aria-hidden="true" />, active: showSource, onSelect: () => setShowSource((shown) => !shown) },
          { key: "about", label: "SVG", disabled: true, separatorBefore: true, onSelect: () => {} },
        ]} />
        {visual}
      </div>
    );
  }

  return (
    <div dir="ltr" className="my-2 overflow-hidden rounded-lg border border-hairline/40 bg-inset">
      <div className="flex items-center justify-between gap-2 border-b border-hairline/30 bg-raised/30 px-3 py-1.5 text-xs">
        <span className="min-w-0 truncate rounded border border-hairline/40 bg-raised px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-ink select-none">
          SVG
        </span>
        <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
          <button
            type="button"
            onClick={() => setShowSource((visible) => !visible)}
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors ${
              showSource ? "bg-accent/15 text-accent font-medium" : "text-ink-secondary hover:bg-raised hover:text-ink"
            }`}
            aria-pressed={showSource}
          >
            <WrapText size={12} aria-hidden="true" />
            <span className="hidden sm:inline">{t(showSource ? "chat.mermaid.hideSource" : "chat.mermaid.showSource")}</span>
          </button>
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ink-secondary hover:bg-raised hover:text-ink transition-colors"
          >
            {copied === "failed" ? (
              <><X size={12} className="text-danger" aria-hidden="true" /><span className="text-danger font-medium hidden sm:inline">{t("common.copyFailed")}</span></>
            ) : copied === "copied" ? (
              <><Check size={12} className="text-success" aria-hidden="true" /><span className="text-success font-medium hidden sm:inline">{t("chat.code.copiedShort")}</span></>
            ) : (
              <><Copy size={12} aria-hidden="true" /><span className="hidden sm:inline">{t("common.copy")}</span></>
            )}
          </button>
        </div>
      </div>
      {visual}
    </div>
  );
}
