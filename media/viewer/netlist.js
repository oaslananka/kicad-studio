(function () {
  const rowsEl = document.getElementById('netlist-rows');
  const summaryText = document.getElementById('summary-text');

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'setNetlist') {
      const nets = message.payload.nets || [];
      const fragment = document.createDocumentFragment();
      summaryText.textContent = message.payload.status || `${nets.length} net entries`;
      for (const net of nets) {
        const row = document.createElement('tr');
        const netName = document.createElement('td');
        const nodes = document.createElement('td');
        netName.textContent = net.netName || '';
        nodes.textContent = (net.nodes || []).map((node) => `${node.reference}:${node.pin}`).join(', ') || '—';
        row.append(netName, nodes);
        fragment.appendChild(row);
      }
      rowsEl.replaceChildren(fragment);
    }
  });
})();
