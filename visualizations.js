window.TR = window.TR || {};

TR.visualizations = (() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function svgElement(tag, attrs = {}) {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== null && value !== undefined) element.setAttribute(key, String(value));
    }
    return element;
  }

  function clear(element) {
    element.replaceChildren();
  }

  function heatColor(ratio, hasValue) {
    if (!hasValue) return 'rgba(49, 90, 112, 0.035)';
    const alpha = 0.12 + TR.utils.clamp(ratio, 0, 1) * 0.78;
    return `rgba(49, 90, 112, ${alpha.toFixed(3)})`;
  }

  function renderHeatmap(container, matrix, { onCellClick = () => {} } = {}) {
    clear(container);
    const grid = document.createElement('div');
    grid.className = 'heatmap-grid';
    grid.style.gridTemplateColumns = `minmax(150px, 220px) repeat(${matrix.books.length}, minmax(78px, 1fr))`;

    const corner = document.createElement('div');
    corner.className = 'heatmap-corner sticky-column sticky-row';
    corner.textContent = matrix.granularity === 'segment' ? 'קטע מקור' : 'פרק';
    grid.append(corner);

    matrix.books.forEach(book => {
      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'heatmap-book sticky-row';
      header.title = book.title;
      header.innerHTML = `<span style="--book-color:${TR.utils.hashColor(book.slug)}"></span>${TR.utils.escapeHtml(book.title)}`;
      header.addEventListener('click', () => onCellClick({ book, row: null, cell: null }));
      grid.append(header);
    });

    matrix.rows.forEach(row => {
      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'heatmap-row-label sticky-column';
      label.textContent = row.label;
      label.title = row.label;
      label.addEventListener('click', () => onCellClick({ row, book: null, cell: null }));
      grid.append(label);

      row.cells.forEach(cell => {
        const ratio = matrix.maxValue ? cell.value / matrix.maxValue : 0;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'heatmap-cell';
        button.style.background = heatColor(ratio, cell.value > 0);
        button.style.color = ratio < 0.38 ? '#273844' : '#ffffff';
        button.dataset.hasValue = cell.value > 0 ? 'true' : 'false';
        button.textContent = formatHeatValue(cell.value, matrix.metric);
        button.title = [
          row.label,
          cell.book.title,
          cell.book.resourceId && cell.book.resourceId !== cell.book.slug ? `Resource: ${cell.book.resourceId}` : '',
          cell.book.localResource?.versions?.length ? `גרסאות: ${cell.book.localResource.versions.join(' · ')}` : '',
          `ערך: ${formatHeatValue(cell.value, matrix.metric)}`,
          `מועמדים: ${cell.stats.count}`,
          `ציון מנורמל מרבי: ${TR.utils.percent(cell.stats.maxNorm, 1)}`,
          `התאמות מלאות: ${cell.stats.exact}`
        ].filter(Boolean).join('\n');
        button.addEventListener('click', () => onCellClick({ row, book: cell.book, cell }));
        grid.append(button);
      });
    });

    container.append(grid);
  }

  function formatHeatValue(value, metric) {
    if (!value) return '';
    if (metric === 'maxNorm' || metric === 'avgNorm') return TR.utils.percent(value, 0);
    return TR.utils.compactNumber(value, 0);
  }

  function layoutNetwork(graph, width, height) {
    const nodes = graph.nodes.map((node, index) => {
      const angle = (index / Math.max(1, graph.nodes.length)) * Math.PI * 2;
      const radius = Math.min(width, height) * 0.34;
      return {
        ...node,
        x: width / 2 + Math.cos(angle) * radius,
        y: height / 2 + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        radius: 9 + Math.sqrt(Math.max(1, node.count)) * 1.8
      };
    });
    const nodeMap = new Map(nodes.map(node => [node.id, node]));
    const edges = graph.edges.map(edge => ({ ...edge, sourceNode: nodeMap.get(edge.source), targetNode: nodeMap.get(edge.target) })).filter(edge => edge.sourceNode && edge.targetNode);

    for (let step = 0; step < 360; step += 1) {
      const alpha = 1 - step / 360;
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let distanceSq = dx * dx + dy * dy;
          if (distanceSq < 1) distanceSq = 1;
          const distance = Math.sqrt(distanceSq);
          const minimum = a.radius + b.radius + 14;
          const repulsion = (9000 / distanceSq) * alpha;
          dx /= distance;
          dy /= distance;
          a.vx -= dx * repulsion;
          a.vy -= dy * repulsion;
          b.vx += dx * repulsion;
          b.vy += dy * repulsion;
          if (distance < minimum) {
            const push = (minimum - distance) * 0.08;
            a.vx -= dx * push;
            a.vy -= dy * push;
            b.vx += dx * push;
            b.vy += dy * push;
          }
        }
      }

      for (const edge of edges) {
        const a = edge.sourceNode;
        const b = edge.targetNode;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        dx /= distance;
        dy /= distance;
        const targetLength = 150 - Math.min(70, edge.count * 4);
        const spring = (distance - targetLength) * (0.004 + Math.min(0.012, edge.count * 0.0008)) * alpha;
        a.vx += dx * spring;
        a.vy += dy * spring;
        b.vx -= dx * spring;
        b.vy -= dy * spring;
      }

      for (const node of nodes) {
        node.vx += (width / 2 - node.x) * 0.0018 * alpha;
        node.vy += (height / 2 - node.y) * 0.0018 * alpha;
        node.vx *= 0.84;
        node.vy *= 0.84;
        node.x = TR.utils.clamp(node.x + node.vx, node.radius + 12, width - node.radius - 12);
        node.y = TR.utils.clamp(node.y + node.vy, node.radius + 12, height - node.radius - 12);
      }
    }
    return { nodes, edges };
  }

  function renderNetwork(svg, graph, { onNodeClick = () => {}, onEdgeClick = () => {} } = {}) {
    clear(svg);
    const width = 1000;
    const height = 650;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'רשת קשרי קו־הופעה בין ספרים');

    if (!graph.nodes.length) {
      const text = svgElement('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'empty-svg-label' });
      text.textContent = 'אין די נתונים להצגת רשת בסף הנוכחי';
      svg.append(text);
      return;
    }

    const layout = layoutNetwork(graph, width, height);
    const edgeLayer = svgElement('g', { class: 'network-edges' });
    const nodeLayer = svgElement('g', { class: 'network-nodes' });
    svg.append(edgeLayer, nodeLayer);

    const maxCount = Math.max(1, ...layout.edges.map(edge => edge.count));
    for (const edge of layout.edges) {
      const line = svgElement('line', {
        x1: edge.sourceNode.x,
        y1: edge.sourceNode.y,
        x2: edge.targetNode.x,
        y2: edge.targetNode.y,
        'stroke-width': 0.8 + (edge.count / maxCount) * 6,
        class: 'network-edge',
        tabindex: 0
      });
      const title = svgElement('title');
      title.textContent = `${edge.sourceNode.title} ↔ ${edge.targetNode.title}: ${edge.count} קטעים משותפים`;
      line.append(title);
      line.addEventListener('click', () => onEdgeClick(edge));
      edgeLayer.append(line);
    }

    for (const node of layout.nodes) {
      const group = svgElement('g', {
        class: 'network-node',
        transform: `translate(${node.x}, ${node.y})`,
        tabindex: 0,
        role: 'button',
        'aria-label': `${node.title}, ${node.count} קטעים`
      });
      const circle = svgElement('circle', {
        r: node.radius,
        fill: node.color,
        'fill-opacity': 0.88
      });
      const label = svgElement('text', {
        x: 0,
        y: node.radius + 17,
        'text-anchor': 'middle',
        class: 'network-node-label'
      });
      label.textContent = truncate(node.title, 24);
      const title = svgElement('title');
      const authors = (node.book?.metadata?.authors || []).map(author => author.he || author.en).filter(Boolean).join(', ');
      title.textContent = [
        node.title,
        node.resourceId && node.resourceId !== node.id ? `Resource: ${node.resourceId}` : '',
        node.book?.localResource?.categories?.length ? node.book.localResource.categories.join(' › ') : '',
        authors ? `מחבר: ${authors}` : '',
        node.book?.metadata?.compDateString ? `זמן: ${node.book.metadata.compDateString}` : '',
        `מופיע ב־${node.count} קטעים`
      ].filter(Boolean).join('\n');
      group.append(circle, label, title);
      group.addEventListener('click', () => onNodeClick(node));
      group.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') onNodeClick(node);
      });
      enableDrag(svg, group, node, layout, edgeLayer);
      nodeLayer.append(group);
    }
  }

  function enableDrag(svg, group, node, layout, edgeLayer) {
    let dragging = false;
    const move = event => {
      if (!dragging) return;
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const local = point.matrixTransform(matrix.inverse());
      node.x = local.x;
      node.y = local.y;
      group.setAttribute('transform', `translate(${node.x}, ${node.y})`);
      [...edgeLayer.children].forEach((line, index) => {
        const edge = layout.edges[index];
        line.setAttribute('x1', edge.sourceNode.x);
        line.setAttribute('y1', edge.sourceNode.y);
        line.setAttribute('x2', edge.targetNode.x);
        line.setAttribute('y2', edge.targetNode.y);
      });
    };
    const up = () => {
      dragging = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    group.addEventListener('pointerdown', event => {
      dragging = true;
      event.preventDefault();
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  function renderScatter(svg, points, { onPointClick = () => {} } = {}) {
    clear(svg);
    const width = 1000;
    const height = 620;
    const margin = { top: 24, right: 30, bottom: 62, left: 78 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'תרשים פיזור של ציון מנורמל מול ציון יישור');

    const root = svgElement('g', { transform: `translate(${margin.left}, ${margin.top})` });
    svg.append(root);
    const x = value => TR.utils.clamp(value, 0, 1) * innerWidth;
    const y = value => innerHeight - TR.utils.clamp(value, 0, 1) * innerHeight;

    const grid = svgElement('g', { class: 'scatter-grid' });
    for (let i = 0; i <= 5; i += 1) {
      const value = i / 5;
      grid.append(svgElement('line', { x1: x(value), y1: 0, x2: x(value), y2: innerHeight }));
      grid.append(svgElement('line', { x1: 0, y1: y(value), x2: innerWidth, y2: y(value) }));
      const xLabel = svgElement('text', { x: x(value), y: innerHeight + 28, 'text-anchor': 'middle' });
      xLabel.textContent = `${Math.round(value * 100)}%`;
      const yLabel = svgElement('text', { x: -12, y: y(value) + 4, 'text-anchor': 'end' });
      yLabel.textContent = `${Math.round(value * 100)}%`;
      grid.append(xLabel, yLabel);
    }
    root.append(grid);

    const xTitle = svgElement('text', { x: innerWidth / 2, y: innerHeight + 54, 'text-anchor': 'middle', class: 'axis-title' });
    xTitle.textContent = 'ציון מנורמל';
    const yTitle = svgElement('text', { x: -innerHeight / 2, y: -54, transform: 'rotate(-90)', 'text-anchor': 'middle', class: 'axis-title' });
    yTitle.textContent = 'ציון יישור';
    root.append(xTitle, yTitle);

    const pointsLayer = svgElement('g', { class: 'scatter-points' });
    for (const point of points) {
      const circle = svgElement('circle', {
        cx: x(point.x),
        cy: y(point.y),
        r: TR.utils.clamp(point.size, 2.2, 8),
        fill: point.color,
        class: 'scatter-point',
        tabindex: 0
      });
      const title = svgElement('title');
      title.textContent = [
        point.candidate.localTitle || point.candidate.bookTitle,
        point.candidate.resourceId ? `Resource: ${point.candidate.resourceId}` : '',
        point.candidate.passageId ? `Passage: ${point.candidate.passageId}` : '',
        point.record.localMetadata?.passageId || point.record.displayRef,
        `ציון מנורמל: ${TR.utils.percent(point.candidate.normScore, 1)}`,
        `ציון יישור: ${TR.utils.percent(point.candidate.alignmentScore, 1)}`,
        `score: ${TR.utils.compactNumber(point.candidate.score)}`
      ].filter(Boolean).join('\n');
      circle.append(title);
      circle.addEventListener('click', () => onPointClick(point));
      pointsLayer.append(circle);
    }
    root.append(pointsLayer);
  }

  function truncate(text, length) {
    const value = String(text ?? '');
    return value.length > length ? `${value.slice(0, length - 1)}…` : value;
  }

  return { renderHeatmap, renderNetwork, renderScatter };
})();
