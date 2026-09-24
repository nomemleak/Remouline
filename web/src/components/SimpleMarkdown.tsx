// Renders the small Markdown subset used by the terms / privacy / legal pages:
// "#"/"##"/"###" headings, "- " lists, paragraphs, **bold** and `code`. Everything
// is rendered as React text (never as HTML), so an edited page cannot inject markup.
import { Fragment } from 'react';

function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function SimpleMarkdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{inline(para.join(' '))}</p>);
    if (list.length) blocks.push(<ul key={blocks.length} style={{ paddingLeft: 'var(--s-5)', display: 'grid', gap: 'var(--s-1)' }}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    para = [];
    list = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (!line) flush();
    else if (heading) {
      flush();
      const level = heading[1].length;
      blocks.push(level === 1 ? <h1 key={blocks.length}>{heading[2]}</h1> : level === 2 ? <h3 key={blocks.length}>{heading[2]}</h3> : <h4 key={blocks.length}>{heading[2]}</h4>);
    } else if (line.startsWith('- ')) {
      if (para.length) flush();
      list.push(line.slice(2));
    } else {
      if (list.length) flush();
      para.push(line);
    }
  }
  flush();
  return <div className="stack">{blocks}</div>;
}
