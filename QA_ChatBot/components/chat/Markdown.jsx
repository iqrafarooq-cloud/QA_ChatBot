"use client";

import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Loader2 } from "lucide-react";
import CodeBlock from "./CodeBlock";
import TestCaseTable from "./TestCaseTable";
import { parseTestCaseBlock } from "@/lib/testcases";

const hastText = (node) => (node.type === "text" ? node.value : (node.children || []).map(hastText).join(""));

// Turns [S1] markers into links (outside code fences) so they render as citation chips.
function linkCitations(text) {
  return text
    .split(/(```[\s\S]*?(?:```|$))/g)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/\[(S\d{1,3})\](?!\()/g, "[$1](#cite-$1)")))
    .join("");
}

function Markdown({ content, sources = [], messageId, artifacts, streaming, onCite }) {
  const source = useMemo(() => linkCitations(content), [content]);
  // Offsets of qa-testcases fences, used to give each table a stable index for saved edits.
  const tcOffsets = useMemo(() => [...source.matchAll(/```qa-testcases/g)].map((m) => m.index), [source]);

  const components = useMemo(
    () => ({
      pre({ node }) {
        const code = node.children?.[0];
        const cls = code?.properties?.className || [];
        const lang = (Array.isArray(cls) ? cls : [cls]).map(String).find((c) => c.startsWith("language-"))?.slice(9) || "";
        const raw = hastText(code || node).replace(/\n$/, "");
        if (lang === "qa-testcases") {
          const rows = parseTestCaseBlock(raw);
          const blockIndex = Math.max(0, tcOffsets.indexOf(node.position?.start?.offset));
          if (!rows) {
            return (
              <div className="flex items-center gap-2 rounded-xl border border-dashed border-violet-400/30 bg-violet-500/10 px-4 py-3 text-sm text-violet-300">
                <Loader2 size={15} className="animate-spin" />
                {streaming ? `Building test case table… ${(raw.match(/"id"\s*:/g) || []).length} cases so far` : "The test case block could not be parsed. Ask QA ChatBot to regenerate it."}
              </div>
            );
          }
          return <TestCaseTable key={`${messageId}-${blockIndex}`} initialRows={artifacts?.[blockIndex] || rows} messageId={messageId} blockIndex={blockIndex} />;
        }
        // Re-render highlighted children from the hast tree via the default code renderer.
        return (
          <CodeBlock lang={lang} raw={raw}>
            {code?.children?.length ? <HastChildren nodes={code.children} /> : raw}
          </CodeBlock>
        );
      },
      table: ({ children }) => (
        <div className="md-table">
          <table>{children}</table>
        </div>
      ),
      a({ href = "", children }) {
        if (href.startsWith("#cite-")) {
          const id = href.slice(6);
          const s = sources.find((x) => x.id === id);
          return (
            <button
              type="button"
              onClick={() => onCite?.(id)}
              title={s ? `${s.fileName} - ${s.location}` : "Source"}
              className="mx-0.5 inline-flex -translate-y-px items-center rounded-md bg-violet-500/10 px-1.5 py-px align-baseline font-mono text-[11px] font-semibold text-violet-300 ring-1 ring-violet-400/30 hover:bg-white/10"
            >
              {id}
            </button>
          );
        }
        return (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      },
    }),
    [sources, messageId, artifacts, streaming, onCite, tcOffsets]
  );

  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}

// Minimal hast -> React renderer for highlighted code spans.
function HastChildren({ nodes }) {
  return nodes.map((n, i) => {
    if (n.type === "text") return n.value;
    if (n.type !== "element") return null;
    const cls = n.properties?.className;
    return (
      <span key={i} className={Array.isArray(cls) ? cls.join(" ") : cls}>
        <HastChildren nodes={n.children || []} />
      </span>
    );
  });
}

export default memo(Markdown);
