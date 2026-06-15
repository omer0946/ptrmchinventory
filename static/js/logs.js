document.addEventListener('DOMContentLoaded', () => {
    loadLogs();
    document.getElementById('action-filter').addEventListener('change', loadLogs);
    document.getElementById('reason-filter').addEventListener('change', loadLogs);
});

function buildLogsQuery() {
    const action = document.getElementById('action-filter').value;
    const reason = document.getElementById('reason-filter').value;
    const params = new URLSearchParams();
    if (action) params.set('action', action);
    if (reason) params.set('reason', reason);
    return params.toString();
}

async function loadLogs() {
    const tbody = document.getElementById('logs-table-body');
    const query = buildLogsQuery();
    const url = query ? `/api/logs?${query}` : '/api/logs';

    const exportBtn = document.getElementById('export-logs-btn');
    exportBtn.href = query ? `/api/reports/logs.xlsx?${query}` : '/api/reports/logs.xlsx';

    try {
        const logs = await apiRequest(url);

        if (!logs.length) {
            tbody.innerHTML = '<tr><td colspan="12" class="text-slate-500">No log entries found.</td></tr>';
            return;
        }

        tbody.innerHTML = logs.map((log) => {
            const heatBatch = [log.heat_number, log.batch_number].filter(Boolean).join(' / ');
            const mtrCell = log.mtr_file
                ? `<a href="/static/${log.mtr_file}" target="_blank" class="text-blue-400 hover:text-blue-300">View PDF</a>`
                : '-';
            const reasonCell = log.reason
                ? `<span class="badge ${log.reason === 'Consumed' ? 'badge-ok' : 'badge-low'}">${escapeHtml(log.reason)}</span>`
                : '-';
            const slipCell = (log.action === 'CHECK_OUT' || log.action === 'TRANSFER')
                ? `<a href="/logs/${log.id}/slip" target="_blank" class="btn-icon" title="View / Print Slip">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.066 48.066 0 011.913-.247m10.5 0a48.11 48.11 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125V6.34" /></svg>
                    </a>`
                : '-';

            return `
                <tr>
                    <td class="text-slate-400 whitespace-nowrap">${formatDateTime(log.timestamp)}</td>
                    <td class="font-medium text-white">${escapeHtml(log.user)}</td>
                    <td>${escapeHtml(actionLabel(log.action))}</td>
                    <td>${escapeHtml(log.item || '-')}</td>
                    <td>${escapeHtml(log.location || '-')}</td>
                    <td>${escapeHtml(log.target_location || '-')}</td>
                    <td>${log.quantity !== null && log.quantity !== undefined ? formatNumber(log.quantity) : '-'}</td>
                    <td class="text-slate-400 whitespace-nowrap">${escapeHtml(heatBatch || '-')}</td>
                    <td>${reasonCell}</td>
                    <td>${mtrCell}</td>
                    <td class="text-slate-400 max-w-sm truncate" title="${escapeHtml(log.notes)}">${escapeHtml(log.notes || '-')}</td>
                    <td class="text-right">${slipCell}</td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="12" class="text-red-400">${escapeHtml(err.message)}</td></tr>`;
    }
}
