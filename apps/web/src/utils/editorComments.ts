export type CommentLanguage =
  | 'json'
  | 'javascript'
  | 'xml'
  | 'html'
  | 'graphql'
  | 'yaml'
  | 'text';

export interface CommentToggleResult {
  nextValue: string;
  nextStart: number;
  nextEnd: number;
}

function getCommentPrefix(language: CommentLanguage): {
  prefix: string;
  suffix: string;
} {
  if (language === 'yaml') {
    return { prefix: '# ', suffix: '' };
  }
  if (language === 'html' || language === 'xml') {
    return { prefix: '<!-- ', suffix: ' -->' };
  }
  return { prefix: '// ', suffix: '' };
}

function isLineCommented(
  line: string,
  language: CommentLanguage,
): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (language === 'yaml') return trimmed.startsWith('#');
  if (language === 'html' || language === 'xml') {
    return trimmed.startsWith('<!--') && trimmed.endsWith('-->');
  }
  return trimmed.startsWith('//');
}

function uncommentLine(line: string, language: CommentLanguage): string {
  if (!line.trim()) return line;
  if (language === 'yaml') {
    return line.replace(/^(\s*)#\s?/, '$1');
  }
  if (language === 'html' || language === 'xml') {
    return line.replace(/^(\s*)<!--\s?([\s\S]*?)\s?-->(\s*)$/, '$1$2$3');
  }
  return line.replace(/^(\s*)\/\/\s?/, '$1');
}

function commentLine(line: string, language: CommentLanguage): string {
  const { prefix, suffix } = getCommentPrefix(language);
  const match = line.match(/^(\s*)(.*)$/);
  const indent = match ? match[1] : '';
  const rest = match ? match[2] : line;
  if (!rest && suffix) {
    return `${indent}${prefix.trim()}${suffix}`;
  }
  return `${indent}${prefix}${rest}${suffix}`;
}

/**
 * Toggles line comments across all lines touched by [selectionStart, selectionEnd].
 */
export function toggleCommentOnSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  language: CommentLanguage = 'text',
): CommentToggleResult {
  const lineStart = value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
  const rawLineEnd = value.indexOf('\n', selectionEnd);
  const lineEnd = rawLineEnd === -1 ? value.length : rawLineEnd;

  const block = value.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const hasNonEmpty = lines.some((l) => l.trim().length > 0);
  const shouldUncomment =
    hasNonEmpty && lines.every((l) => isLineCommented(l, language));

  const updatedLines = lines.map((line) =>
    shouldUncomment
      ? uncommentLine(line, language)
      : commentLine(line, language),
  );
  const updatedBlock = updatedLines.join('\n');
  const nextValue =
    value.slice(0, lineStart) + updatedBlock + value.slice(lineEnd);

  const delta = updatedBlock.length - block.length;
  const isSingleCaret = selectionStart === selectionEnd;
  if (isSingleCaret) {
    const nextPos = Math.max(lineStart, selectionStart + delta);
    return { nextValue, nextStart: nextPos, nextEnd: nextPos };
  }

  return {
    nextValue,
    nextStart: lineStart,
    nextEnd: Math.max(lineStart, lineEnd + delta),
  };
}

/**
 * Strips full-line comments from request payloads/inputs before sending.
 */
export function stripCommentedLines(
  text: string,
  language: CommentLanguage = 'text',
): string {
  if (!text) return text;
  const filtered = text
    .split('\n')
    .filter((line) => !isLineCommented(line, language) || !line.trim())
    .join('\n');

  if (language === 'json') {
    return filtered.replace(/,(\s*[}\]])/g, '$1');
  }
  return filtered;
}
