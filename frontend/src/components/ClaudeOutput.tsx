import React, { useEffect, useRef, useMemo } from 'react';
import AnsiToHtml from 'ansi-to-html';

interface ClaudeOutputProps {
  rawOutput: string;
}

const ClaudeOutput: React.FC<ClaudeOutputProps> = ({ rawOutput }) => {
  const outputRef = useRef<HTMLDivElement>(null);
  
  // ANSI色コードをHTMLに変換するインスタンス
  const ansiConverter = useMemo(() => new AnsiToHtml({
    fg: '#00ff00', // デフォルトの緑色
    bg: '#1a1a1a', // ダークな背景色
    newline: true,
    escapeXML: true,
    stream: false
  }), []);

  // ANSI色コードをHTMLに変換
  const convertedOutput = useMemo(() => {
    console.log('ClaudeOutput rawOutput:', rawOutput);
    if (!rawOutput) return 'Claude CLIの出力がここに表示されます<br/>リポジトリを選択してClaude CLIを開始してください';
    const converted = ansiConverter.toHtml(rawOutput);
    console.log('ClaudeOutput converted:', converted);
    return converted;
  }, [rawOutput, ansiConverter]);

  // 新しい出力が追加されたら自動スクロール
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [rawOutput]);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">
          Claude Code CLI 出力
        </h2>
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 bg-red-500 rounded-full"></div>
          <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
          <div className="w-3 h-3 bg-green-500 rounded-full"></div>
        </div>
      </div>
      
      <div
        ref={outputRef}
        className="h-96 overflow-y-auto p-4 bg-gray-900 font-mono text-sm leading-relaxed"
        style={{ 
          margin: 0,
          fontFamily: '"Fira Code", "SF Mono", Monaco, Inconsolata, "Roboto Mono", "Source Code Pro", monospace'
        }}
        dangerouslySetInnerHTML={{ __html: convertedOutput }}
      />
    </div>
  );
};

export default ClaudeOutput;