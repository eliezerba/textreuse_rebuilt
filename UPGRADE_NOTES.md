# Synopsis Reader upgrade

## Layout correction

The source and dataset text cards are explicitly assigned to the same CSS Grid row. Their header areas use the same fixed grid track, so both text bodies begin on the same vertical baseline.

## Single-passage synopsis

- The source-book passage remains fixed in the right-hand column.
- Previous/next buttons and a source-passage selector navigate in source-book order.
- Candidate selections remain scoped to the current source passage.
- Optional automatic reselection runs when navigating between source passages.

## Smart candidate strategies

- Recommended: weighted strength with book and dataset diversity.
- Strongest candidates.
- Leading candidate from each book.
- Leading candidate from each loaded dataset.
- Full alignments first.
- Manual selection only.

All strategies operate only on non-self candidates that satisfy the active global filters.

## Continuous reading

Continuous mode renders a vertical sequence of source-book passages. Each row keeps the source passage on the right and displays the selected dataset candidates to its left. Candidate books may therefore change from one source passage to the next. Scrolling within each row can be synchronized.

## Navigation

- Arrow Up / Page Up: previous source passage in synopsis.
- Arrow Down / Page Down: next source passage in synopsis.
- Continuous mode can advance in batches and open any row as a single synopsis or in the reading view.
