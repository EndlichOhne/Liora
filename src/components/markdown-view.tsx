import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { Check, Copy } from "lucide-react";

function CodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = String(children ?? "");
  return (
    <div className="relative">
      <button
        type="button"
        className="absolute top-2 right-2 inline-flex min-h-9 min-w-9 items-center justify-center rounded-sm text-muted hover:bg-background hover:text-foreground"
        aria-label="Code kopieren"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
      <pre>
        <code>{text.replace(/\n$/, "")}</code>
      </pre>
    </div>
  );
}

export function MarkdownView({ content }: { content: string }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const value = String(children ?? "");
            const block = Boolean(className) || value.includes("\n");
            if (!block) return <code>{value}</code>;
            return <CodeBlock>{value}</CodeBlock>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
