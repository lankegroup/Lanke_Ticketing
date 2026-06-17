type Locale = 'zh' | 'en';

export interface RemarkLimit {
  current: number;
  max: number;
  unit: '字' | 'words' | 'chars';
}

export interface RemarkValidationResult {
  valid: boolean;
  message: string;
  limit: RemarkLimit;
}

export function validateRemark(text: string, locale: Locale = 'zh'): RemarkValidationResult {
  if (!text || text.trim().length === 0) {
    return {
      valid: true,
      message: '',
      limit: { current: 0, max: locale === 'zh' ? 30 : 20, unit: locale === 'zh' ? '字' : 'words' },
    };
  }

  const trimmed = text.trim();

  if (locale === 'zh') {
    const chineseCount = (trimmed.match(/[\u4e00-\u9fa5\u3000-\u303F\uff00-\uffef]/g) || []).length;
    const otherCount = trimmed.length - chineseCount;
    const totalCount = chineseCount + Math.ceil(otherCount / 2);
    
    if (totalCount > 30) {
      return {
        valid: false,
        message: `备注内容过长，请精简至30字以内（当前${totalCount}字）`,
        limit: { current: totalCount, max: 30, unit: '字' },
      };
    }

    return {
      valid: true,
      message: '',
      limit: { current: totalCount, max: 30, unit: '字' },
    };
  } else {
    const words = trimmed.split(/\s+/).filter(w => w.length > 0).length;
    const chars = trimmed.length;

    if (words > 20) {
      return {
        valid: false,
        message: `Remark is too long. Please limit to 20 words (current: ${words} words)`,
        limit: { current: words, max: 20, unit: 'words' },
      };
    }

    if (chars > 120) {
      return {
        valid: false,
        message: `Remark is too long. Please limit to 120 characters (current: ${chars})`,
        limit: { current: chars, max: 120, unit: 'chars' },
      };
    }

    return {
      valid: true,
      message: '',
      limit: { current: words, max: 20, unit: 'words' },
    };
  }
}

export function getRemarkLimit(text: string, locale: Locale = 'zh'): RemarkLimit {
  if (!text || text.trim().length === 0) {
    return { current: 0, max: locale === 'zh' ? 30 : 20, unit: locale === 'zh' ? '字' : 'words' };
  }

  const trimmed = text.trim();

  if (locale === 'zh') {
    const chineseCount = (trimmed.match(/[\u4e00-\u9fa5\u3000-\u303F\uff00-\uffef]/g) || []).length;
    const otherCount = trimmed.length - chineseCount;
    const totalCount = chineseCount + Math.ceil(otherCount / 2);
    return { current: totalCount, max: 30, unit: '字' };
  } else {
    const words = trimmed.split(/\s+/).filter(w => w.length > 0).length;
    return { current: words, max: 20, unit: 'words' };
  }
}

export function getEnglishCharLimit(text: string): { current: number; max: number } {
  if (!text) {
    return { current: 0, max: 120 };
  }
  return { current: text.length, max: 120 };
}

export function truncateRemark(text: string, locale: Locale = 'zh'): string {
  if (!text) return '';
  
  const trimmed = text.trim();

  if (locale === 'zh') {
    if (trimmed.length <= 30) return trimmed;
    
    const chineseCount = (trimmed.match(/[\u4e00-\u9fa5\u3000-\u303F\uff00-\uffef]/g) || []).length;
    if (chineseCount <= 30) {
      let count = 0;
      let result = '';
      for (const char of trimmed) {
        if (/[\u4e00-\u9fa5\u3000-\u303F\uff00-\uffef]/.test(char)) {
          count++;
        } else {
          count += 0.5;
        }
        if (count > 30) break;
        result += char;
      }
      return result + '...';
    }
    
    const chineseChars = trimmed.match(/[\u4e00-\u9fa5\u3000-\u303F\uff00-\uffef]/g) || [];
    return chineseChars.slice(0, 30).join('') + '...';
  } else {
    const words = trimmed.split(/\s+/).filter(w => w.length > 0);
    if (words.length <= 20 && trimmed.length <= 120) return trimmed;
    
    let result = '';
    let wordCount = 0;
    let charCount = 0;
    
    for (const word of words) {
      if (wordCount >= 20) break;
      const newCharCount = charCount + word.length + (result ? 1 : 0);
      if (newCharCount > 120) break;
      
      result = result ? result + ' ' + word : word;
      wordCount++;
      charCount = newCharCount;
    }
    
    return result + (words.length > 20 || trimmed.length > 120 ? '...' : '');
  }
}