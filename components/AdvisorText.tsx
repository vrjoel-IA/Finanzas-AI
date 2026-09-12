import React from 'react';

// All content remains React text. Only these two formatting markers create elements.
export default function AdvisorText({ text }: { text: string }) {
  return <>{text.split('\n').map((line, i) => {
    const isQuestion = line.includes('?') && line.trim().length > 10;
    const parts = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
    return <p key={i} className={`${isQuestion ? 'bg-blue-100/50 dark:bg-blue-900/20 p-3 rounded-xl border-l-4 border-blue-500 dark:border-blue-400 my-2' : 'mb-3'} min-h-[1em] transition-colors`}>
      {parts.map((part, index) => part.startsWith('**') && part.endsWith('**') && part.length > 4
        ? <strong key={index} className="font-black text-slate-900 dark:text-white transition-colors">{part.slice(2, -2)}</strong>
        : part.startsWith('*') && part.endsWith('*') && part.length > 2
          ? <em key={index} className="text-blue-600 dark:text-blue-400 font-bold transition-colors">{part.slice(1, -1)}</em>
          : part)}
    </p>;
  })}</>;
}
