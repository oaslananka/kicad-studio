(function () {
  const vscode = acquireVsCodeApi();
  const search = document.getElementById('search');
  const toggleDnp = document.getElementById('toggle-dnp');
  const rowsEl = document.getElementById('bom-rows');
  const summaryText = document.getElementById('summary-text');
  const headers = [...document.querySelectorAll('th[data-key]')];
  let entries = [];
  let sortKey = 'references';
  let sortDir = 1;

  function rowMatches(entry, query) {
    const text = [
      entry.references.join(' '),
      entry.value,
      entry.footprint,
      entry.mpn,
      entry.manufacturer,
      entry.description
    ]
      .join(' ')
      .toLowerCase();
    return text.includes(query);
  }

  function render() {
    const query = search.value.trim().toLowerCase();
    const hideDnp = toggleDnp.checked;
    const filtered = entries
      .filter((entry) => !hideDnp || !entry.dnp)
      .filter((entry) => rowMatches(entry, query))
      .sort((left, right) => {
        const a = sortKey === 'references' ? left.references.join(',') : left[sortKey];
        const b = sortKey === 'references' ? right.references.join(',') : right[sortKey];
        return String(a).localeCompare(String(b), undefined, { numeric: true }) * sortDir;
      });

    const fragment = document.createDocumentFragment();
    for (const entry of filtered) {
      fragment.appendChild(createRow(entry));
    }
    rowsEl.replaceChildren(fragment);

    for (const row of rowsEl.querySelectorAll('tr')) {
      row.addEventListener('click', () => {
        vscode.postMessage({
          type: 'rowSelected',
          payload: { reference: row.dataset.reference }
        });
      });
    }
  }

  function createRow(entry) {
    const row = document.createElement('tr');
    row.dataset.reference = entry.references[0] || '';
    appendTextCell(row, entry.references.join(', '));
    appendTextCell(row, entry.quantity);
    appendTextCell(row, entry.value);
    appendTextCell(row, entry.footprint);
    appendTextCell(row, entry.mpn, true);
    appendTextCell(row, entry.manufacturer, true);
    appendLcscCell(row, entry.lcsc);
    appendTextCell(row, entry.description, true);
    return row;
  }

  function appendTextCell(row, value, mutedWhenEmpty) {
    const cell = document.createElement('td');
    const text = String(value ?? '');
    if (mutedWhenEmpty && !text) {
      const muted = document.createElement('span');
      muted.className = 'muted';
      muted.textContent = '—';
      cell.appendChild(muted);
    } else {
      cell.textContent = text;
    }
    row.appendChild(cell);
  }

  function appendLcscCell(row, value) {
    const cell = document.createElement('td');
    if (value) {
      const link = document.createElement('a');
      link.className = 'chip-link';
      link.href = `https://www.lcsc.com/search?q=${encodeURIComponent(value)}`;
      link.textContent = value;
      cell.appendChild(link);
    } else {
      const muted = document.createElement('span');
      muted.className = 'muted';
      muted.textContent = '—';
      cell.appendChild(muted);
    }
    row.appendChild(cell);
  }

  headers.forEach((header) => {
    header.addEventListener('click', () => {
      const nextKey = header.dataset.key;
      if (sortKey === nextKey) {
        sortDir *= -1;
      } else {
        sortKey = nextKey;
        sortDir = 1;
      }
      render();
    });
  });

  search.addEventListener('input', render);
  toggleDnp.addEventListener('change', render);
  document.getElementById('btn-export-csv').addEventListener('click', () => {
    vscode.postMessage({ type: 'exportCsv' });
  });
  document.getElementById('btn-export-xlsx').addEventListener('click', () => {
    vscode.postMessage({ type: 'exportXlsx' });
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'setData') {
      entries = message.payload.entries || [];
      const summary = message.payload.summary || { totalComponents: 0, uniqueValues: 0 };
      summaryText.textContent = `${summary.totalComponents} components, ${summary.uniqueValues} unique rows`;
      render();
    }
    if (message.type === 'highlight') {
      const target = rowsEl.querySelector(`[data-reference="${message.payload.reference}"]`);
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });
})();
