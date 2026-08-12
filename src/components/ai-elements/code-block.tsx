"use client";

/**
 * Syntax-highlighted code block for the AI chat panel (lazy-loaded by
 * tool.tsx to render tool input/output JSON). Highlighting delegates to the
 * `@streamdown/code` shiki plugin — the same instance MessageResponse hands
 * to Streamdown — so grammars/WASM load once and lazily. Raw text is shown
 * until async highlighting resolves. Trimmed to the single CodeBlock export;
 * header/filename/actions/copy-button/language-selector chrome was removed.
 */

import type { CSSProperties, HTMLAttributes } from "react";
import type { BundledLanguage, ThemedToken } from "shiki";

import { cn } from "@/lib/utils";
import { code as codeHighlighter } from "@streamdown/code";
import { memo, useEffect, useMemo, useState } from "react";

// Shiki uses bitflags for font styles: 1=italic, 2=bold, 4=underline
const isItalic = (fontStyle: number | undefined) => fontStyle && fontStyle & 1;
const isBold = (fontStyle: number | undefined) => fontStyle && fontStyle & 2;
const isUnderline = (fontStyle: number | undefined) => fontStyle && fontStyle & 4;

type TokenizedCode = {
  tokens: ThemedToken[][];
  fg?: string;
  bg?: string;
}

// Token rendering component
const TokenSpan = ({ token }: { token: ThemedToken }) => (
  <span
    className="dark:!bg-[var(--shiki-dark-bg)] dark:!text-[var(--shiki-dark)]"
    style={
      {
        backgroundColor: token.bgColor,
        color: token.color,
        fontStyle: isItalic(token.fontStyle) ? "italic" : undefined,
        fontWeight: isBold(token.fontStyle) ? "bold" : undefined,
        textDecoration: isUnderline(token.fontStyle) ? "underline" : undefined,
        ...token.htmlStyle,
      } as CSSProperties
    }
  >
    {token.content}
  </span>
);

// Line rendering component
const LineSpan = ({ line }: { line: ThemedToken[] }) => (
  <span className="block">
    {line.length === 0
      ? "\n"
      : line.map((token, i) => <TokenSpan key={i} token={token} />)}
  </span>
);

// Create raw tokens for immediate display while highlighting loads
const createRawTokens = (code: string): TokenizedCode => ({
  tokens: code.split("\n").map((line) =>
    line === ""
      ? []
      : [
          {
            color: "inherit",
            content: line,
          } as ThemedToken,
        ]
  ),
});

const CodeBlockBody = memo(({ tokenized }: { tokenized: TokenizedCode }) => (
  <pre
    className="dark:!bg-[var(--shiki-dark-bg)] dark:!text-[var(--shiki-dark)] m-0 p-4 text-sm"
    style={{
      backgroundColor: tokenized.bg ?? "transparent",
      color: tokenized.fg ?? "inherit",
    }}
  >
    <code className="font-mono text-sm">
      {tokenized.tokens.map((line, i) => (
        <LineSpan key={i} line={line} />
      ))}
    </code>
  </pre>
));

CodeBlockBody.displayName = "CodeBlockBody";

export type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string;
  language: BundledLanguage;
};

export const CodeBlock = ({
  code,
  language,
  className,
  ...props
}: CodeBlockProps) => {
  const [highlighted, setHighlighted] = useState<{
    code: string;
    tokens: TokenizedCode;
  } | null>(null);

  // Single call site: the plugin returns a cached result synchronously or
  // invokes the callback once tokenization finishes. Calling it from render
  // as well would schedule a second tokenization of the same content. The
  // sync (cache-hit) result is applied via a microtask so the effect body
  // never sets state synchronously.
  useEffect(() => {
    let live = true;
    const themes = codeHighlighter.getThemes();
    const apply = (result: TokenizedCode) => {
      if (live) setHighlighted({ code, tokens: result });
    };
    const sync = codeHighlighter.highlight({ code, language, themes }, apply);
    if (sync) {
      queueMicrotask(() => apply(sync));
    }
    return () => {
      live = false;
    };
  }, [code, language]);

  const rawTokens = useMemo(() => createRawTokens(code), [code]);
  // Ignore results for stale code (e.g. a previous streaming chunk).
  const tokenized = highlighted?.code === code ? highlighted.tokens : rawTokens;

  return (
    <div
      className={cn(
        "group relative w-full overflow-hidden rounded-md border bg-background text-foreground",
        className
      )}
      data-language={language}
      style={{
        containIntrinsicSize: "auto 200px",
        contentVisibility: "auto",
      }}
      {...props}
    >
      <div className="relative overflow-auto">
        <CodeBlockBody tokenized={tokenized} />
      </div>
    </div>
  );
};
