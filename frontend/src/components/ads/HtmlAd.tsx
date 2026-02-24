import {useMemo} from 'react';
import DOMPurify from 'dompurify';

type Props = {
  html?: string;
};

const EMPTY_SHELL =
  '<style>body{margin:0;display:flex;align-items:center;justify-content:center;background:#0c1118;color:#f0f4f8;font-family:sans-serif;} .fallback{padding:16px 20px;border-radius:12px;background:#1f2933;box-shadow:0 12px 24px rgba(0,0,0,0.3);} .fallback h1{margin:0;font-size:26px;} .fallback p{margin:6px 0 0;font-size:16px;opacity:.85;}</style><div class="fallback"><h1>Custom creative missing</h1><p>Submit new HTML to replace this slot.</p></div>';

export default function HtmlAd({html}: Props) {
  const sanitized = useMemo(() => {
    const raw = html?.trim();
    const safe = DOMPurify.sanitize(raw && raw.length ? raw : EMPTY_SHELL, {
      ADD_TAGS: ['script'],
      ADD_ATTR: ['target', 'rel', 'async', 'defer'],
      USE_PROFILES: {html: true},
    });
    return safe;
  }, [html]);

  return (
    <iframe
      className="html-ad"
      sandbox="allow-scripts allow-forms allow-pointer-lock"
      referrerPolicy="no-referrer"
      srcDoc={sanitized}
      title="Custom creative"
    />
  );
}
