window.TR = window.TR || {};

TR.refTemplates = (() => {
  'use strict';

  const ADDRESS_TOKEN = /^(?:\d+[ab]?|[ivxlcdm]+)$/i;
  const STRUCTURAL_CATEGORIES = new Set([
    'tanakh', 'torah', 'prophets', 'writings', 'talmud', 'bavli', 'yerushalmi',
    'mishnah', 'tosefta', 'midrash', 'aggadic midrash', 'halakhic midrash',
    'halakhah', 'kabbalah', 'chasidut', 'musar', 'jewish thought', 'philosophy',
    'liturgy', 'prayer', 'responsa', 'commentary', 'commentaries', 'targum',
    'reference', 'apocrypha', 'second temple', 'minor tractates', 'modern',
    'contemporary', 'rishonim', 'acharonim', 'geonim', 'tannaim', 'amoraim',
    'early works', 'later works', 'other'
  ]);

  function humanize(value) {
    return String(value || '')
      .replaceAll('__', ' · ')
      .replaceAll('_', ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalize(value) {
    return TR.utils.normalizeText(value)
      .replace(/\bthe\b/g, ' ')
      .replace(/\bof\b/g, ' ')
      .replace(/\band\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function transliterationKey(value) {
    return normalize(value)
      .split(' ')
      .map(token => token
        .replace(/kh|ch/g, 'h')
        .replace(/tz|ts/g, 'z')
        .replace(/sh/g, 's')
        .replace(/ph/g, 'f')
        .replace(/ck/g, 'k')
        .replace(/q/g, 'k')
        .replace(/[aeiouy]/g, '')
        .replace(/(.)\1+/g, '$1'))
      .filter(Boolean)
      .join(' ');
  }

  function slugifyTitle(value) {
    return humanize(value).replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'Unknown';
  }

  function isAddressToken(value) {
    return ADDRESS_TOKEN.test(String(value || '').trim());
  }

  function addressParts(value) {
    const text = String(value || '').trim();
    const chunks = text.split(/[_:.\s]+/).filter(Boolean);
    return chunks.length && chunks.every(isAddressToken) ? chunks : [];
  }

  function isAddressCategory(value) {
    return addressParts(value).length > 0;
  }

  function isStructuralCategory(value) {
    const key = normalize(humanize(value));
    if (!key) return true;
    if (STRUCTURAL_CATEGORIES.has(key)) return true;
    if (/^(?:seder|order)\b/.test(key)) return true;
    if (/^(?:tractates?|books?|works?)\b/.test(key)) return true;
    if (/\b(?:commentary|commentaries|supercommentary|targum)\b/.test(key)) return true;
    return false;
  }

  function inferBookSlug(prefix) {
    const chunks = String(prefix || '').split('_').filter(Boolean);
    return chunks.length > 2 ? chunks.slice(2).join('_') : String(prefix || '');
  }

  function inferBookCategoryIndex(categories) {
    const path = Array.isArray(categories) ? categories.filter(value => String(value || '').trim()) : [];
    if (!path.length) return -1;

    for (let index = 0; index < path.length; index += 1) {
      if (!isStructuralCategory(path[index]) && !isAddressCategory(path[index])) return index;
    }

    for (let index = path.length - 1; index >= 0; index -= 1) {
      if (!isAddressCategory(path[index])) return index;
    }
    return path.length - 1;
  }

  function splitHierarchyTail(values) {
    const namedSlugs = [];
    const numericTokens = [];
    let numericStarted = false;
    let mixedAfterAddress = false;

    for (const value of values || []) {
      const numbers = addressParts(value);
      if (numbers.length) {
        numericStarted = true;
        numericTokens.push(...numbers);
      } else if (!numericStarted) {
        namedSlugs.push(value);
      } else {
        mixedAfterAddress = true;
        namedSlugs.push(value);
      }
    }
    return {
      namedSlugs,
      namedTitles: namedSlugs.map(humanize),
      numericTokens,
      mixedAfterAddress
    };
  }

  function splitSuffix(suffix) {
    const suffixTokens = String(suffix || '').split('_').filter(Boolean);
    const addressTokens = [];
    for (let index = suffixTokens.length - 1; index >= 0; index -= 1) {
      const token = suffixTokens[index];
      if (isAddressToken(token)) addressTokens.unshift(token);
      else break;
    }
    const namedTokens = suffixTokens.slice(0, suffixTokens.length - addressTokens.length);
    return {
      suffixTokens,
      namedTokens,
      namedTitle: humanize(namedTokens.join('_')),
      addressTokens
    };
  }

  function composeLocation(raw, categories, bookCategoryIndex, canonicalTitle = '') {
    const separatorIndex = raw.indexOf('__');
    const prefix = separatorIndex >= 0 ? raw.slice(0, separatorIndex) : raw;
    const suffix = separatorIndex >= 0 ? raw.slice(separatorIndex + 2) : '';
    const categoryPathRaw = Array.isArray(categories) ? categories.filter(value => String(value || '').trim()) : [];
    const categoryPath = categoryPathRaw.map(humanize);
    const inferredSlug = inferBookSlug(prefix);
    const safeIndex = bookCategoryIndex >= 0 && bookCategoryIndex < categoryPathRaw.length
      ? bookCategoryIndex
      : inferBookCategoryIndex(categoryPathRaw);
    const categorySlug = safeIndex >= 0 ? categoryPathRaw[safeIndex] : '';
    const bookTitle = humanize(canonicalTitle || categorySlug || inferredSlug || 'Unknown');
    const bookSlug = slugifyTitle(canonicalTitle || categorySlug || inferredSlug || 'Unknown');

    const hierarchyTail = safeIndex >= 0 ? splitHierarchyTail(categoryPathRaw.slice(safeIndex + 1)) : splitHierarchyTail([]);
    const suffixParts = splitSuffix(suffix);
    const namedPathTitles = [...hierarchyTail.namedTitles];
    if (suffixParts.namedTitle) namedPathTitles.push(suffixParts.namedTitle);
    const namedTitle = namedPathTitles.join(' ').trim();
    const addressTokens = [...hierarchyTail.numericTokens, ...suffixParts.addressTokens];
    const address = addressTokens.join(':');

    const directRef = !namedPathTitles.length && address
      ? `${bookTitle} ${address}`
      : null;
    const commaRef = namedPathTitles.length
      ? `${bookTitle}, ${namedPathTitles.join(', ')}${address ? ` ${address}` : ''}`
      : null;
    const compactNodeRef = namedTitle
      ? `${bookTitle}, ${namedTitle}${address ? ` ${address}` : ''}`
      : null;
    const looseRef = `${bookTitle}${namedTitle ? ` ${namedTitle}` : ''}${address ? ` ${addressTokens.join(' ')}` : ''}`.trim();
    const refCandidates = [...new Set([directRef, commaRef, compactNodeRef, looseRef].filter(Boolean))];

    const issues = [];
    if (!raw) issues.push({ code: 'missing-location', message: 'חסר location למועמד.' });
    if (separatorIndex < 0) issues.push({ code: 'missing-separator', message: 'המיקום אינו כולל את המפריד הקבוע __.' });
    if (!categoryPathRaw.length) issues.push({ code: 'missing-categories', message: 'חסרות source_categories ולכן שם הספר מוסק מן המזהה.' });
    if (safeIndex > -1 && safeIndex < categoryPathRaw.length - 1) {
      issues.push({
        code: 'nested-work-path',
        message: `שם החיבור זוהה ברמה ${safeIndex + 1} של הנתיב; הרמות שאחריו מטופלות כיחידות פנימיות או ככתובת.`
      });
    }
    if (hierarchyTail.mixedAfterAddress) {
      issues.push({ code: 'mixed-hierarchy-address', message: 'בנתיב הופיעה כותרת לאחר רכיב מספרי; התבנית תאומת מול סכמת ספריא.' });
    }
    if (categorySlug && prefix && !normalize(humanize(prefix)).includes(normalize(humanize(categorySlug)))) {
      issues.push({ code: 'book-mismatch', message: `שם החיבור שנבחר (${humanize(categorySlug)}) אינו מופיע במפורש בחלק הראשון של המיקום.` });
    }
    if (!suffix && !hierarchyTail.numericTokens.length) issues.push({ code: 'missing-suffix', message: 'חסר החלק המתאר את היחידה בתוך הספר.' });
    if (!addressTokens.length) issues.push({ code: 'missing-address', message: 'לא זוהתה כתובת מספרית; ייתכן שמדובר בכותרת או במבנה מורכב.' });

    return {
      raw,
      prefix,
      suffix,
      inferredSlug,
      categorySlug,
      categoryPathRaw,
      categoryPath,
      bookCategoryIndex: safeIndex,
      categoryAncestors: safeIndex >= 0 ? categoryPathRaw.slice(0, safeIndex) : [],
      categoryNodeSlugs: hierarchyTail.namedSlugs,
      categoryNodeTitles: hierarchyTail.namedTitles,
      categoryAddressTokens: hierarchyTail.numericTokens,
      bookSlug,
      bookTitle,
      suffixTokens: suffixParts.suffixTokens,
      namedTokens: suffixParts.namedTokens,
      suffixNamedTitle: suffixParts.namedTitle,
      namedPathTitles,
      namedTitle,
      addressTokens,
      address,
      directRef,
      simpleRef: directRef,
      refCandidates,
      searchQuery: commaRef || compactNodeRef || looseRef || bookTitle,
      display: directRef || commaRef || compactNodeRef || looseRef || humanize(raw),
      issues,
      templateVersion: 3,
      hierarchyResolution: canonicalTitle ? 'canonical' : 'local-path'
    };
  }

  function parseLocation(location, categories = []) {
    const raw = String(location || '').trim();
    const index = inferBookCategoryIndex(categories);
    return composeLocation(raw, categories, index);
  }

  function hierarchyCandidates(parsed) {
    const categories = parsed?.categoryPathRaw || [];
    const output = [];
    for (let index = 0; index < categories.length; index += 1) {
      if (isAddressCategory(categories[index])) continue;
      const tail = splitHierarchyTail(categories.slice(index + 1));
      output.push({
        bookCategoryIndex: index,
        proposedTitle: humanize(categories[index]),
        proposedSlug: categories[index],
        ancestors: categories.slice(0, index),
        nodeSlugs: tail.namedSlugs,
        nodeTitles: tail.namedTitles,
        categoryAddressTokens: tail.numericTokens,
        localScore: index === parsed.bookCategoryIndex ? 1 : 0
      });
    }
    if (!output.length && parsed?.bookTitle) {
      output.push({
        bookCategoryIndex: -1,
        proposedTitle: parsed.bookTitle,
        proposedSlug: parsed.bookSlug,
        ancestors: [],
        nodeSlugs: [],
        nodeTitles: [],
        categoryAddressTokens: [],
        localScore: 1
      });
    }
    return output;
  }

  function applyHierarchy(parsed, hierarchy = {}) {
    if (!parsed) return parsed;
    const categoryIndex = Number.isInteger(hierarchy.bookCategoryIndex)
      ? hierarchy.bookCategoryIndex
      : parsed.bookCategoryIndex;
    const canonicalTitle = hierarchy.canonicalTitle || hierarchy.title || hierarchy.bookTitle || '';
    return {
      ...composeLocation(parsed.raw, parsed.categoryPathRaw || [], categoryIndex, canonicalTitle),
      hierarchyResolution: hierarchy.resolution || (canonicalTitle ? 'sefaria-hierarchy' : parsed.hierarchyResolution),
      hierarchyConfidence: Number(hierarchy.confidence || hierarchy.score || 0),
      hierarchyAttempts: hierarchy.attempts || []
    };
  }

  function nodeTitles(node) {
    const titles = Array.isArray(node?.titles) ? node.titles : [];
    const english = titles.filter(title => title.lang === 'en').sort((a, b) => Number(b.primary) - Number(a.primary));
    const values = english.map(title => title.text).filter(Boolean);
    if (node?.primaryTitle) values.unshift(node.primaryTitle);
    if (node?.title) values.unshift(node.title);
    if (node?.sharedTitle) values.push(humanize(node.sharedTitle));
    if (node?.key && !/^(default|root)$/i.test(node.key)) values.push(humanize(node.key));
    return [...new Set(values.filter(Boolean))];
  }

  function primaryNodeTitle(node) {
    return nodeTitles(node)[0] || '';
  }

  function isDefaultNode(node) {
    return Boolean(node?.default) || /^(default)$/i.test(String(node?.key || ''));
  }

  function flattenSchema(rawIndex) {
    const root = rawIndex?.schema || rawIndex;
    if (!root || typeof root !== 'object') return [];
    const output = [];

    function walk(node, path, variants) {
      const isRoot = node === root;
      const titles = nodeTitles(node);
      const primary = primaryNodeTitle(node);
      const omit = isRoot || isDefaultNode(node);
      const nextPath = omit || !primary ? path : [...path, primary];
      const nextVariants = omit || !titles.length ? variants : [...variants, titles];
      const children = Array.isArray(node.nodes) ? node.nodes : [];
      if (!children.length) {
        output.push({
          path: nextPath,
          variants: nextVariants,
          depth: Number(node.depth || 0),
          addressTypes: node.addressTypes || [],
          sectionNames: node.sectionNames || [],
          node
        });
        return;
      }
      children.forEach(child => walk(child, nextPath, nextVariants));
    }

    walk(root, [], []);
    return output;
  }

  function fuzzyTokenMatch(a, b) {
    const left = normalize(a);
    const right = normalize(b);
    if (!left || !right) return false;
    if (left === right) return true;
    const leftKey = transliterationKey(left);
    const rightKey = transliterationKey(right);
    return Boolean(leftKey && rightKey && leftKey === rightKey);
  }

  function tokenSimilarity(a, b) {
    const aTokens = normalize(a).split(' ').filter(Boolean);
    const bTokens = normalize(b).split(' ').filter(Boolean);
    if (!aTokens.length && !bTokens.length) return 1;
    if (!aTokens.length || !bTokens.length) return 0;
    const used = new Set();
    let intersection = 0;
    for (const left of aTokens) {
      const matchIndex = bTokens.findIndex((right, index) => !used.has(index) && fuzzyTokenMatch(left, right));
      if (matchIndex >= 0) {
        used.add(matchIndex);
        intersection += 1;
      }
    }
    const precision = intersection / bTokens.length;
    const recall = intersection / aTokens.length;
    return precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  }

  function pathSimilarity(expected, actual) {
    const left = (expected || []).filter(Boolean);
    const right = (actual || []).filter(Boolean);
    if (!left.length && !right.length) return 1;
    if (!left.length || !right.length) return 0;
    const full = tokenSimilarity(left.join(' '), right.join(' '));
    const pairs = Math.min(left.length, right.length);
    let ordered = 0;
    for (let index = 0; index < pairs; index += 1) ordered += tokenSimilarity(left[index], right[index]);
    ordered = pairs ? ordered / Math.max(left.length, right.length) : 0;
    return Math.max(full, ordered);
  }

  function variantCombinations(groups, limit = 120) {
    if (!groups.length) return [[]];
    let combinations = [[]];
    for (const group of groups) {
      const titles = group.slice(0, 6);
      const next = [];
      for (const combo of combinations) {
        for (const title of titles) {
          next.push([...combo, title]);
          if (next.length >= limit) return next;
        }
      }
      combinations = next;
    }
    return combinations;
  }

  function sectionToDaf(value) {
    const section = Number(value);
    if (!Number.isInteger(section) || section < 2) return String(value || '');
    const daf = Math.floor(section / 2) + 1;
    const amud = section % 2 === 0 ? 'a' : 'b';
    return `${daf}${amud}`;
  }

  function formatAddressTokens(tokens, addressTypes = []) {
    return (tokens || []).map((token, index) => {
      const type = String(addressTypes[index] || '').toLowerCase();
      if (/talmud|bavlidaf|dafamud/.test(type) && /^\d+$/.test(String(token))) {
        return sectionToDaf(token);
      }
      return String(token);
    });
  }

  function addressVariants(tokens, depth = 0, addressTypes = []) {
    const raw = (tokens || []).map(String).filter(Boolean);
    const candidates = [];
    const seen = new Set();

    function add(values, reason) {
      if (!values.length) return;
      const formatted = formatAddressTokens(values, addressTypes);
      const key = formatted.join(':');
      if (!key || seen.has(key)) return;
      seen.add(key);
      candidates.push({ rawTokens: values, formattedTokens: formatted, address: key, reason });
    }

    // Prefer an address whose length matches the schema. TEXTREUSE paths can
    // repeat a chapter/section level both before and after the __ separator.
    if (depth > 0 && raw.length > depth) add(raw.slice(-depth), 'schema-depth-tail');
    if (depth > 0 && raw.length === depth) add(raw, 'schema-depth-exact');

    // Remove only adjacent duplicates as a conservative normalization.
    const collapsed = raw.filter((value, index) => index === 0 || value !== raw[index - 1]);
    if (depth > 0 && collapsed.length >= depth) add(collapsed.slice(-depth), 'collapsed-duplicate-tail');

    // Retain the original and other schema-length windows as fallbacks. The
    // Sefaria Ref endpoint will decide which candidate is actually valid.
    add(raw, 'raw-address');
    if (depth > 0 && raw.length > depth) {
      add(raw.slice(0, depth), 'schema-depth-head');
      for (let start = 1; start + depth < raw.length; start += 1) {
        add(raw.slice(start, start + depth), 'schema-depth-window');
      }
    }
    return candidates;
  }

  function matchSchemaRef(parsed, rawIndex) {
    const canonicalTitle = rawIndex?.title || parsed.bookTitle;
    const leaves = flattenSchema(rawIndex);
    if (!leaves.length) return null;
    const namedPath = parsed.namedPathTitles || (parsed.namedTitle ? [parsed.namedTitle] : []);
    const addressCount = parsed.addressTokens.length;
    let best = null;

    for (const leaf of leaves) {
      const combinations = variantCombinations(leaf.variants);
      if (!combinations.length) combinations.push(leaf.path);
      for (const path of combinations) {
        const pathText = path.join(' ');
        let score = namedPath.length ? pathSimilarity(namedPath, path) : (path.length ? 0.12 : 1);
        const namedNorm = normalize(namedPath.join(' '));
        const pathNorm = normalize(pathText);
        if (namedNorm && pathNorm && (namedNorm.includes(pathNorm) || pathNorm.includes(namedNorm))) score += 0.28;
        if (transliterationKey(namedNorm) && transliterationKey(namedNorm) === transliterationKey(pathNorm)) score += 0.24;
        if (addressCount && leaf.depth) {
          const distance = Math.abs(addressCount - leaf.depth);
          score += distance === 0 ? 0.24 : distance === 1 ? 0.08 : -0.14;
        }
        if (!namedPath.length && path.length) score -= 0.38;
        if (!best || score > best.score) best = { leaf, path, score };
      }
    }

    if (!best || best.score < 0.3) return null;
    // Variants are used only for matching. The emitted ref always uses the
    // primary schema path so aliases/transliteration variants do not leak into
    // the canonical Sefaria reference.
    const canonicalPath = best.leaf.path || best.path;
    const pathPart = canonicalPath.length ? `, ${canonicalPath.join(', ')}` : '';
    const variants = addressVariants(parsed.addressTokens, best.leaf.depth, best.leaf.addressTypes);
    const refCandidates = variants.map(variant => ({
      ref: `${canonicalTitle}${pathPart}${variant.address ? ` ${variant.address}` : ''}`.trim(),
      ...variant
    }));
    const primary = refCandidates[0] || {
      ref: `${canonicalTitle}${pathPart}`.trim(),
      rawTokens: [],
      formattedTokens: [],
      address: '',
      reason: 'book-or-node-only'
    };
    return {
      ref: primary.ref,
      refCandidates,
      score: best.score,
      path: canonicalPath,
      matchedVariantPath: best.path,
      depth: best.leaf.depth,
      sectionNames: best.leaf.sectionNames,
      addressTypes: best.leaf.addressTypes,
      rawAddress: parsed.address,
      formattedAddress: primary.address,
      formattedAddressTokens: primary.formattedTokens,
      addressResolution: primary.reason
    };
  }

  function categoryPathSimilarity(expected, actual) {
    const left = (expected || []).map(humanize);
    const right = (actual || []).map(humanize);
    if (!left.length && !right.length) return 1;
    if (!left.length || !right.length) return 0;
    const pairs = Math.min(left.length, right.length);
    let score = 0;
    for (let index = 0; index < pairs; index += 1) score += tokenSimilarity(left[index], right[index]);
    return score / Math.max(left.length, right.length);
  }

  function structuralSummary(candidates) {
    const counts = new Map();
    for (const candidate of candidates || []) {
      const parsed = candidate.refTemplate || parseLocation(candidate.sourceLocation, candidate.categories);
      for (const issue of parsed.issues) counts.set(issue.code, (counts.get(issue.code) || 0) + 1);
    }
    return [...counts.entries()].map(([code, count]) => ({ code, count }));
  }

  return {
    parseLocation,
    applyHierarchy,
    hierarchyCandidates,
    inferBookCategoryIndex,
    isStructuralCategory,
    isAddressCategory,
    splitHierarchyTail,
    flattenSchema,
    matchSchemaRef,
    categoryPathSimilarity,
    pathSimilarity,
    tokenSimilarity,
    transliterationKey,
    sectionToDaf,
    formatAddressTokens,
    addressVariants,
    structuralSummary,
    normalize,
    humanize,
    slugifyTitle,
    ROMAN_TOKEN: /^(?:i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv|xvi|xviii|xix|xx)$/i
  };
})();
