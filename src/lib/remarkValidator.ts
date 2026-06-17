export function validateRemark(text: string): { valid: boolean; message: string } {
  if (!text || text.trim().length === 0) {
    return { valid: true, message: '' };
  }

  const trimmed = text.trim();
  
  const chineseCount = (trimmed.match(/[\u4e00-\u9fa5\u3000-\u303F\uff00-\uffef]/g) || []).length;
  
  const noSpaceText = trimmed.replace(/\s+/g, '');
  const westernGroups = (noSpaceText.match(/[a-zA-Z0-9]+|[^\u4e00-\u9fa5\s]/g) || []).length;

  if (chineseCount > 30) {
    return { valid: false, message: `中文内容超过30个字符（当前${chineseCount}个）` };
  }

  if (westernGroups > 20) {
    return { valid: false, message: `西文字组超过20个（当前${westernGroups}个）` };
  }

  return { valid: true, message: '' };
}

export function getRemarkLimit(text: string): { chinese: number; western: number; maxChinese: number; maxWestern: number } {
  if (!text) {
    return { chinese: 0, western: 0, maxChinese: 30, maxWestern: 20 };
  }

  const trimmed = text.trim();
  const chineseCount = (trimmed.match(/[\u4e00-\u9fa5\u3000-\u303F\uff00-\uffef]/g) || []).length;
  const noSpaceText = trimmed.replace(/\s+/g, '');
  const westernGroups = (noSpaceText.match(/[a-zA-Z0-9]+|[^\u4e00-\u9fa5\s]/g) || []).length;

  return {
    chinese: chineseCount,
    western: westernGroups,
    maxChinese: 30,
    maxWestern: 20,
  };
}