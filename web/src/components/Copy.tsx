import { useState } from 'react';
import { IconCopy } from './Icons';

/** Copy-to-clipboard control with a short confirmation state. */
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // clipboard API needs a secure context; fall back to a selection copy
      const area = document.createElement('textarea');
      area.value = value;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button onClick={() => void copy()} className="btn-ghost !px-3 !py-2 text-xs">
      <IconCopy />
      {copied ? 'Copied' : label}
    </button>
  );
}
