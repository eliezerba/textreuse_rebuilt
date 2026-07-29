window.TR = window.TR || {};

TR.utils = (() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const alignmentMapCache = new WeakMap();

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizeText(value) {
    return String(value ?? '')
      .normalize('NFKD')
      .replace(/[\u0591-\u05C7]/g, '')
      .replace(/[<>{}\[\]()*+?.\\^$|,:;"'`~!@#%&/=\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function humanize(value) {
    return String(value ?? '')
      .replaceAll('__', ' · ')
      .replaceAll('_', ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function compactNumber(value, digits = 1) {
    const number = finite(value, NaN);
    if (!Number.isFinite(number)) return '—';
    return new Intl.NumberFormat('he-IL', {
      maximumFractionDigits: number >= 100 ? 0 : digits
    }).format(number);
  }

  function percent(value, digits = 0) {
    const number = finite(value, NaN);
    if (!Number.isFinite(number)) return '—';
    return `${(number * 100).toFixed(digits)}%`;
  }

  function debounce(fn, wait = 180) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(resolve));
  }

  function hashColor(key) {
    const palette = TR.config.palette;
    let hash = 2166136261;
    for (const char of String(key ?? '')) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return palette[Math.abs(hash) % palette.length];
  }

  function scoreTone(value) {
    const n = clamp(finite(value), 0, 1);
    if (n >= 0.82) return 'very-high';
    if (n >= 0.62) return 'high';
    if (n >= 0.38) return 'medium';
    if (n >= 0.18) return 'low';
    return 'very-low';
  }

  function locationParts(location, categories = []) {
    const raw = String(location ?? '');
    const [prefix, suffix = ''] = raw.split('__', 2);
    const bookSlug = categories.at(-1) || inferBookSlug(prefix);
    const bookTitle = humanize(bookSlug);
    const suffixTokens = suffix ? suffix.split('_').filter(Boolean) : [];
    const numericTail = [];
    for (let i = suffixTokens.length - 1; i >= 0; i -= 1) {
      if (/^\d+[ab]?$|^[ivxlcdm]+$/i.test(suffixTokens[i])) {
        numericTail.unshift(suffixTokens[i]);
      } else {
        break;
      }
    }
    const namedTokens = suffixTokens.slice(0, suffixTokens.length - numericTail.length);
    const simpleRef = namedTokens.length === 0 && numericTail.length
      ? `${bookTitle} ${numericTail.join(':')}`
      : null;
    const searchQuery = `${bookTitle} ${humanize(suffix)}`.trim();
    return {
      raw,
      prefix,
      suffix,
      bookSlug,
      bookTitle,
      namedTokens,
      numericTail,
      simpleRef,
      searchQuery,
      display: simpleRef || (suffix ? `${bookTitle}, ${humanize(suffix)}` : bookTitle)
    };
  }

  function inferBookSlug(prefix) {
    const chunks = String(prefix ?? '').split('_');
    if (chunks.length <= 2) return prefix;
    return chunks.slice(2).join('_');
  }

  function chapterKey(location) {
    const suffix = String(location ?? '').split('__', 2)[1] || '';
    const tokens = suffix.split('_').filter(Boolean);
    const firstNumeric = tokens.find(token => /^\d+$/.test(token));
    if (firstNumeric) return firstNumeric;
    return tokens.slice(0, Math.min(tokens.length, 3)).join(' ') || 'ללא חלוקה';
  }

  function tokenCount(text) {
    return String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
  }

  function chooseAlignedHtml(details, role) {
    const originalText = details.passage_text || '';
    const candidateText = details.source_text || '';
    const originalCandidates = [details.seq_source_html, details.passage_html];
    const sourceCandidates = [details.seq_passage_html, details.source_html];
    const list = role === 'original' ? originalCandidates : sourceCandidates;
    const expected = role === 'original' ? tokenCount(originalText) : tokenCount(candidateText);
    const useful = list.filter(Boolean).map(html => ({ html, distance: Math.abs(tokenCount(stripHtml(html)) - expected) }));
    useful.sort((a, b) => a.distance - b.distance);
    return useful[0]?.html || escapeHtml(role === 'original' ? originalText : candidateText);
  }

  function parseAlignmentPairs(details) {
    let sequence = details?.alignment_sequence;
    if (!sequence) return [];
    if (typeof sequence === 'string') {
      try { sequence = JSON.parse(sequence); } catch { return []; }
    }
    const pairs = [];
    function walk(value) {
      if (!Array.isArray(value)) return;
      if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
        pairs.push({
          originalIndex: Number(value[0]),
          candidateIndex: Number(value[1]),
          strength: Number.isFinite(Number(value[2])) ? Number(value[2]) : 1,
          kind: String(value[3] || 'match')
        });
        return;
      }
      value.forEach(walk);
    }
    walk(sequence);
    return pairs;
  }

  function alignmentTone(kind, strength = 1) {
    const normalized = String(kind || '').toLowerCase();
    if (normalized.includes('exact') || strength >= 0.95) return 'exact';
    if (normalized.includes('fuzzy') || normalized.includes('edit') || normalized.includes('partial') || strength < 0.55) return 'fuzzy';
    return 'related';
  }

  function tokenSequence(text) {
    return String(text || '').trim().split(/\s+/).filter(Boolean).map((raw, index) => ({
      raw,
      index,
      normalized: normalizeText(raw)
    }));
  }

  function htmlTone(rawStyle) {
    const style = String(rawStyle || '').toLowerCase();
    const colorValue = style.match(/color\s*:\s*([^;\s]+)/)?.[1] || '';
    const isBlack = /^(#000000|black|rgb\(0,\s*0,\s*0\))$/.test(colorValue);
    const isGreen = /green|#a1f0a9|#00(?:80)?00/.test(colorValue);
    const isBold = /font-weight\s*:\s*(bold|[6-9]00)/.test(style);
    if (!isBlack && isGreen) return 'exact';
    if (!isBlack && colorValue) return 'related';
    if (isBold) return 'fuzzy';
    return null;
  }

  function styledHtmlTokens(html) {
    if (typeof document === 'undefined') return [];
    const template = document.createElement('template');
    template.innerHTML = String(html || '')
      .replace(/<text\b/gi, '<span')
      .replace(/<\/text>/gi, '</span>')
      .replace(/<font\b/gi, '<span')
      .replace(/<\/font>/gi, '</span>');
    const tokens = [];

    function visit(node, inheritedTone = null) {
      if (node.nodeType === Node.TEXT_NODE) {
        String(node.textContent || '').split(/\s+/).filter(Boolean).forEach(raw => {
          tokens.push({ raw, normalized: normalizeText(raw), tone: inheritedTone });
        });
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const ownTone = node.tagName.toUpperCase() === 'SPAN'
        ? htmlTone(`${node.getAttribute('style') || ''}${node.getAttribute('color') ? `;color:${node.getAttribute('color')}` : ''}`)
        : null;
      const tone = ownTone || inheritedTone;
      for (const child of node.childNodes) visit(child, tone);
    }

    for (const child of template.content.childNodes) visit(child, null);
    return tokens;
  }

  function lcsPairs(left, right) {
    const n = left.length;
    const m = right.length;
    if (!n || !m) return [];
    const matrix = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = 1; i <= n; i += 1) {
      const leftToken = left[i - 1]?.normalized || '';
      for (let j = 1; j <= m; j += 1) {
        if (leftToken && leftToken === (right[j - 1]?.normalized || '')) {
          matrix[i][j] = matrix[i - 1][j - 1] + 1;
        } else {
          matrix[i][j] = Math.max(matrix[i - 1][j], matrix[i][j - 1]);
        }
      }
    }
    const pairs = [];
    let i = n;
    let j = m;
    while (i > 0 && j > 0) {
      if (left[i - 1]?.normalized && left[i - 1].normalized === right[j - 1]?.normalized) {
        pairs.push([i - 1, j - 1]);
        i -= 1;
        j -= 1;
      } else if (matrix[i - 1][j] >= matrix[i][j - 1]) {
        i -= 1;
      } else {
        j -= 1;
      }
    }
    return pairs.reverse();
  }

  function tonesFromOwnHtml(text, html) {
    const textTokens = tokenSequence(text);
    const htmlTokens = styledHtmlTokens(html);
    const map = new Map();
    if (!textTokens.length || !htmlTokens.length || !htmlTokens.some(token => token.tone)) return map;

    const direct = textTokens.length === htmlTokens.length
      && textTokens.reduce((count, token, index) => count + (token.normalized && token.normalized === htmlTokens[index]?.normalized ? 1 : 0), 0) / textTokens.length >= 0.82;
    const pairs = direct
      ? textTokens.map((_, index) => [index, index])
      : lcsPairs(textTokens, htmlTokens);
    for (const [textIndex, htmlIndex] of pairs) {
      const tone = htmlTokens[htmlIndex]?.tone;
      if (!tone) continue;
      map.set(textIndex, { tone, strength: tone === 'exact' ? 1 : tone === 'related' ? 0.72 : 0.45, kind: 'html' });
    }
    return map;
  }

  function editDistance(left, right) {
    const a = String(left || '');
    const b = String(right || '');
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
      const current = [i];
      for (let j = 1; j <= b.length; j += 1) {
        current[j] = Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
      previous = current;
    }
    return previous[b.length];
  }

  function hebrewStem(token) {
    let value = String(token || '');
    if (value.length > 4 && /^[והבכלמש]/.test(value)) value = value.slice(1);
    value = value.replace(/(?:יהם|יהן|יכם|יכן|ינו|יהם|ות|ים|תי|נו|יו|יה|ך|ם|ן|ו|י|ה)$/u, '');
    return value.length >= 2 ? value : String(token || '');
  }

  function tokenSimilarity(left, right) {
    const a = String(left || '');
    const b = String(right || '');
    if (!a || !b) return 0;
    if (a === b) return 1;
    const raw = 1 - editDistance(a, b) / Math.max(a.length, b.length);
    const stemA = hebrewStem(a);
    const stemB = hebrewStem(b);
    const stem = stemA === stemB
      ? 0.9
      : 1 - editDistance(stemA, stemB) / Math.max(stemA.length, stemB.length, 1);
    const prefix = a.slice(0, 3) === b.slice(0, 3) && Math.min(a.length, b.length) >= 4 ? 0.68 : 0;
    return Math.max(raw, stem, prefix);
  }

  function inferredAlignmentIndexMap(details, role) {
    const originalText = details?.passage_text || '';
    const candidateText = details?.source_text || '';
    const ownText = role === 'original' ? originalText : candidateText;
    const ownHtml = chooseAlignedHtml(details || {}, role);
    const ownMap = tonesFromOwnHtml(ownText, ownHtml);
    if (ownMap.size) return ownMap;

    const oppositeRole = role === 'original' ? 'candidate' : 'original';
    const oppositeText = role === 'original' ? candidateText : originalText;
    const oppositeTokens = tokenSequence(oppositeText);
    const oppositeMap = tonesFromOwnHtml(oppositeText, chooseAlignedHtml(details || {}, oppositeRole));
    if (!oppositeMap.size) return ownMap;

    const targetTokens = tokenSequence(ownText);
    const highlightedTokens = [...oppositeMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, match]) => ({ ...oppositeTokens[index], match, oppositeIndex: index }));
    const pairs = lcsPairs(targetTokens, highlightedTokens);
    const inferred = new Map();
    const usedTargets = new Set();
    const usedHighlights = new Set();
    for (const [targetIndex, highlightIndex] of pairs) {
      const match = highlightedTokens[highlightIndex]?.match;
      if (!match) continue;
      inferred.set(targetIndex, { ...match, kind: 'inferred-html' });
      usedTargets.add(targetIndex);
      usedHighlights.add(highlightIndex);
    }

    // TEXTREUSE sometimes highlights inflected spellings rather than exact token
    // forms. Map the remaining highlighted words by conservative Hebrew token
    // similarity so the color is still mirrored in the original passage.
    highlightedTokens.forEach((highlighted, highlightIndex) => {
      if (usedHighlights.has(highlightIndex)) return;
      let best = null;
      targetTokens.forEach((target, targetIndex) => {
        if (usedTargets.has(targetIndex)) return;
        const score = tokenSimilarity(target.normalized, highlighted.normalized);
        if (score < 0.64 || (best && score <= best.score)) return;
        best = { targetIndex, score };
      });
      if (!best) return;
      inferred.set(best.targetIndex, {
        ...highlighted.match,
        tone: best.score >= 0.82 ? highlighted.match.tone : 'fuzzy',
        strength: Math.min(highlighted.match.strength || 1, best.score),
        kind: 'inferred-fuzzy-html'
      });
      usedTargets.add(best.targetIndex);
    });
    return inferred;
  }

  function alignmentIndexMap(details, role) {
    const cacheable = details && typeof details === 'object';
    const cached = cacheable ? alignmentMapCache.get(details)?.get(role) : null;
    if (cached) return cached;
    const remember = value => {
      if (cacheable) {
        const roles = alignmentMapCache.get(details) || new Map();
        roles.set(role, value);
        alignmentMapCache.set(details, roles);
      }
      return value;
    };
    const pairs = parseAlignmentPairs(details);
    const map = new Map();
    for (const pair of pairs) {
      const index = role === 'original' ? pair.originalIndex : pair.candidateIndex;
      if (!Number.isInteger(index) || index < 0) continue;
      const tone = alignmentTone(pair.kind, pair.strength);
      const current = map.get(index);
      const rank = tone === 'exact' ? 3 : tone === 'related' ? 2 : 1;
      const currentRank = current?.tone === 'exact' ? 3 : current?.tone === 'related' ? 2 : current ? 1 : 0;
      if (!current || rank > currentRank || pair.strength > current.strength) {
        map.set(index, { tone, strength: clamp(pair.strength, 0.15, 1), kind: pair.kind });
      }
    }

    if (map.size) return remember(map);
    const matrix = role === 'original' ? details?.suspect_matrix : details?.source_matrix;
    if (Array.isArray(matrix)) {
      matrix.forEach((value, index) => {
        const strength = finite(value, 0);
        if (strength <= 0) return;
        map.set(index, { tone: alignmentTone('matrix', strength), strength: clamp(strength, 0.15, 1), kind: 'matrix' });
      });
    }
    return remember(map.size ? map : inferredAlignmentIndexMap(details, role));
  }

  function alignedTextHtml(details, role, options = {}) {
    const text = role === 'original' ? (details?.passage_text || '') : (details?.source_text || '');
    const tokens = String(text).trim().split(/\s+/).filter(Boolean);
    const matches = alignmentIndexMap(details, role);
    const color = options.color || '#2f6b50';
    if (tokens.length && matches.size) {
      return tokens.map((token, index) => {
        const match = matches.get(index);
        if (!match) return `<span class="alignment-plain-token">${escapeHtml(token)}</span>`;
        const opacity = `${Math.round((0.14 + match.strength * 0.22) * 100)}%`;
        return `<span class="alignment-token ${match.tone}" style="--match-color:${escapeHtml(color)};--match-opacity:${opacity}" data-alignment-index="${index}">${escapeHtml(token)}</span>`;
      }).join(' ');
    }
    return sanitizeAlignmentHtml(chooseAlignedHtml(details || {}, role), { color });
  }

  function stripHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = String(html ?? '');
    return template.content.textContent || '';
  }

  function sanitizeAlignmentHtml(html, options = {}) {
    const matchColor = options.color || '#2f6b50';
    const template = document.createElement('template');
    const normalized = String(html ?? '')
      .replace(/<text\b/gi, '<span')
      .replace(/<\/text>/gi, '</span>')
      .replace(/<font\b/gi, '<span')
      .replace(/<\/font>/gi, '</span>');
    template.innerHTML = normalized;

    const out = document.createDocumentFragment();
    const allowedBlocks = new Set(['P', 'BR', 'DIV']);

    function visit(node, parent) {
      if (node.nodeType === Node.TEXT_NODE) {
        parent.append(document.createTextNode(node.textContent || ''));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName.toUpperCase();
      if (tag === 'BR') {
        parent.append(document.createElement('br'));
        return;
      }

      const wrapper = document.createElement(allowedBlocks.has(tag) ? tag.toLowerCase() : 'span');
      if (tag === 'SPAN') {
        const rawStyle = `${node.getAttribute('style') || ''}${node.getAttribute('color') ? `;color:${node.getAttribute('color')}` : ''}`.toLowerCase();
        const tone = htmlTone(rawStyle);
        if (tone) wrapper.className = `alignment-token ${tone}`;
        if (wrapper.className) wrapper.style.setProperty('--match-color', matchColor);
      }
      for (const child of node.childNodes) visit(child, wrapper);
      parent.append(wrapper);
    }

    for (const child of template.content.childNodes) visit(child, out);
    const container = document.createElement('div');
    container.append(out);
    return container.innerHTML;
  }

  function downloadText(filename, text, type = 'text/plain;charset=utf-8') {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function csvEscape(value) {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  async function fetchJson(url, options = {}) {
    const controller = options.signal ? null : new AbortController();
    const timeout = controller ? setTimeout(() => controller.abort(), options.timeoutMs || 9000) : null;
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json', ...(options.headers || {}) },
        signal: options.signal || controller.signal,
        cache: options.cache || 'default'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      return response.json();
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  function setBusy(element, busy, label = '') {
    if (!element) return;
    element.toggleAttribute('aria-busy', Boolean(busy));
    element.classList.toggle('is-busy', Boolean(busy));
    if (label) element.dataset.busyLabel = label;
  }

  return {
    $, $$, clamp, finite, normalizeText, escapeHtml, humanize, compactNumber,
    percent, debounce, nextFrame, hashColor, scoreTone, locationParts, chapterKey,
    chooseAlignedHtml, parseAlignmentPairs, alignmentIndexMap, alignedTextHtml, sanitizeAlignmentHtml, stripHtml, tokenCount, downloadText,
    csvEscape, fetchJson, setBusy
  };
})();
