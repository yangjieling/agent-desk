/* Safe subset markdown for task timeline assistant messages. */
(function (global) {
  function escHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function inlineMarkdown(text) {
    let s = escHtml(text);
    s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
    s = s.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    );
    return s;
  }

  function isTableRow(line) {
    const t = String(line || "").trim();
    return t.startsWith("|") && t.endsWith("|");
  }

  function isTableSep(line) {
    const t = String(line || "").trim();
    return /^\|?[\s:-]+\|[\s|:-]*$/.test(t);
  }

  function parseTableRow(line) {
    return String(line || "")
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
  }

  function renderTable(lines) {
    if (!lines.length) return "";
    const rows = lines.map(parseTableRow);
    const head = rows[0] || [];
    const body = rows.slice(1);
    const thead = `<thead><tr>${head.map((c) => `<th>${inlineMarkdown(c)}</th>`).join("")}</tr></thead>`;
    const tbody = body.length
      ? `<tbody>${body
          .map((r) => `<tr>${r.map((c) => `<td>${inlineMarkdown(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody>`
      : "";
    return `<div class="log-md-table-wrap"><table class="log-md-table">${thead}${tbody}</table></div>`;
  }

  function renderMarkdown(text) {
    const raw = String(text || "");
    if (!raw.trim()) return "";
    const lines = raw.replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        i += 1;
        continue;
      }

      const fence = trimmed.match(/^```(\w*)/);
      if (fence) {
        const lang = fence[1] || "";
        i += 1;
        const block = [];
        while (i < lines.length && !lines[i].trim().startsWith("```")) {
          block.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        const code = escHtml(block.join("\n"));
        out.push(
          `<pre class="log-md-pre"><code${lang ? ` class="lang-${escHtml(lang)}"` : ""}>${code}</code></pre>`,
        );
        continue;
      }

      if (isTableRow(trimmed)) {
        const tableLines = [];
        while (i < lines.length && isTableRow(lines[i])) {
          if (!isTableSep(lines[i])) tableLines.push(lines[i]);
          i += 1;
        }
        out.push(renderTable(tableLines));
        continue;
      }

      if (/^#{1,6}\s+/.test(trimmed)) {
        const level = Math.min(6, trimmed.match(/^#+/)[0].length);
        const content = trimmed.replace(/^#{1,6}\s+/, "");
        out.push(`<h${level} class="log-md-h">${inlineMarkdown(content)}</h${level}>`);
        i += 1;
        continue;
      }

      if (/^[-*]\s+/.test(trimmed)) {
        const items = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
          i += 1;
        }
        out.push(
          `<ul class="log-md-ul">${items.map((it) => `<li>${inlineMarkdown(it)}</li>`).join("")}</ul>`,
        );
        continue;
      }

      if (/^\d+\.\s+/.test(trimmed)) {
        const items = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
          i += 1;
        }
        out.push(
          `<ol class="log-md-ol">${items.map((it) => `<li>${inlineMarkdown(it)}</li>`).join("")}</ol>`,
        );
        continue;
      }

      const para = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        if (!t) break;
        if (
          t.startsWith("```") ||
          isTableRow(t) ||
          /^#{1,6}\s+/.test(t) ||
          /^[-*]\s+/.test(t) ||
          /^\d+\.\s+/.test(t)
        ) {
          break;
        }
        para.push(lines[i]);
        i += 1;
      }
      out.push(
        `<p class="log-md-p">${inlineMarkdown(para.join("\n")).replace(/\n/g, "<br>")}</p>`,
      );
    }

    return `<div class="log-md">${out.join("")}</div>`;
  }

  global.renderLogMarkdown = renderMarkdown;
})(typeof window !== "undefined" ? window : globalThis);
