# ארכיטקטורת המערכת

## שכבות

1. **שרת מקומי (`start_server.py`)**
   - מגיש את קובצי המערכת.
   - מאתר את כל קובצי ה־JSON בתיקייה דרך `/api/json-files`.
   - מחפש פורט פנוי החל מ־8765.

2. **מודל הנתונים (`data-model.js`)**
   - מנרמל קבצים מרובים למבנה אחיד.
   - מפריד בין קטע מקור למועמדים.
   - יוצר אינדקסים לפי קטע, מועמד, ספר ומאגר.
   - מחשב מפת חום, רשתות, פיזור ציונים ונתוני אבחון מבניים.

3. **תבניות מראי מקום (`ref-templates.js`)**
   - מפרקות location לפי המבנה הקבוע `prefix__suffix`.
   - בוחנות את כל רמות `source_categories` כדי לזהות היכן מתחיל החיבור והיכן מתחיל הנתיב הפנימי.
   - מפרידות בין קטגוריות, שם חיבור, צמתי סכמה וכתובת מספרית.
   - מתאימות תעתיקים קרובים, כגון `Khullin` ו־`Chullin`.
   - מעצבות כתובות לפי `addressTypes` של ספריא, לרבות המרת מספרי קטע פנימיים לדף תלמודי.

4. **שירות ספריא (`sefaria.js`)**
   - מאמת כל מועמד לפיצול היררכי מול אינדקס ספריא, קטגוריות האינדקס ועץ הסכמה.
   - טוען את סכמת האינדקס ואת המטא־דאטה.
   - פותר הפניות לפי סדר: סכמה היררכית, תבניות מקומיות, השלמת שם.
   - שומר מטמון מקומי בגרסה נפרדת ומחזיר אבחון מפורט במקרה כשל.

5. **המחשות (`visualizations.js`)**
   - מפת חום.
   - רשת קו־הופעה ורשת מקור–מועמד.
   - תרשים פיזור.

6. **ממשק ובקר מצב (`app.js`)**
   - טעינת מאגרים ובחירה מרובה.
   - קריאה צמודה וניווט.
   - בחירות הסינופסיס והסנכרון בין התצוגות.
   - סינופסיס של מקור יחיד מול מועמד אחד או כמה מועמדים.
   - אבחון הפניות וייצוא CSV/HTML.

## מצב הסינופסיס

- `candidatesByRecord`: מפה בין כל קטע מקור לקבוצת המועמדים שנבחרו עבורו.
- קטע המקור הפעיל הוא תמיד עמודת הבסיס של הסינופסיס.
- `topCount`, `columnWidth`, `syncScroll`: העדפות תצוגה.
- שכבת היישור משחזרת צבעים דו־צדדיים מתוך `alignment_sequence`, מטריצות היישור או סימוני ה־HTML של TEXTREUSE.

הבחירות עצמן נשמרות בזיכרון הדף ואינן משנות את קובצי ה־JSON.

## Source-book rail invariant

The right rail is a navigation structure for the queried source book only. Records are sorted by their parsed source address, and duplicate source passages from multiple loaded JSON datasets are merged. Candidate filters never reorder or replace the source-book rail. Sefaria index metadata supplies the canonical book title when available.

## Synopsis invariant

A synopsis always has exactly one source-book passage in the fixed rightmost column. Every other column is a user-selected candidate belonging to that source passage and originating from the loaded dataset(s). Source passages are never compared with other source passages.

## Knowledge and resolver layer (2026 extension)

The application now separates four concerns while retaining the original UI and view contracts:

```text
Input sources
  ├─ TEXTREUSE JSON ───────────────┐
  └─ Corpus JSON / JSONL / NDJSON ─┤
                                   v
                         Adapter + Passage Registry
                                   |
                  ┌────────────────┼────────────────┐
                  v                v                v
               Local            Sefaria            DTS
               corpus          (legacy/enrich)    (optional)
                  └────────────────┼────────────────┘
                                   v
                              ResolverHub
                                   |
                    TEXTREUSE relations/alignment
                                   |
                    Existing views and visualizations
```

### Modules

- `data-adapters.js`: format detection and parsing. It never assumes every JSON file is a TEXTREUSE result.
- `knowledge.js`: Passage metadata normalization, stable Resource/Passage IDs, word selectors, provenance, conflict retention, and `CorpusRegistry`.
- `resolvers.js`: local registry and optional DTS resolvers behind `ResolverHub`; existing Sefaria service remains available.
- `data-model.js`: keeps the old relation/candidate model, enriches it with passage identities and normalized alignment, and joins the Registry after multi-dataset combination.

### Invariants

1. A TEXTREUSE dataset can be loaded exactly as before without any corpus file.
2. Corpus files never become candidates; they enrich passages by identity.
3. `location` remains a compatibility identifier even when `resourceId` / `passageId` exist.
4. Sefaria, Genizah and VRR behaviors are retained; local and DTS sources are additive.
5. All existing tabs operate on the same `DataModel` contracts. New metadata is optional and must not make a visualization mandatory-dependent on an external resolver.
6. The original raw data are retained for research provenance and diagnostics.
