import { useState, useCallback } from 'react';

export interface UseCopyToClipboardReturn {
  copiedText: string | null;
  copyToClipboard: (text: string) => Promise<void>;
}

export function useCopyToClipboard(): UseCopyToClipboardReturn {
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const copyWithFallback = useCallback((text: string): boolean => {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      return successful;
    } catch {
      document.body.removeChild(textArea);
      return false;
    }
  }, []);

  const copyToClipboard = useCallback(
    async (text: string) => {
      let success = false;
      if (navigator.clipboard && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(text);
          success = true;
        } catch {
          success = copyWithFallback(text);
        }
      } else {
        success = copyWithFallback(text);
      }
      if (success) {
        setCopiedText(text);
        setTimeout(() => setCopiedText(null), 2000);
      }
    },
    [copyWithFallback]
  );

  return { copiedText, copyToClipboard };
}
