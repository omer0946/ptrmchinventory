(async function () {
    try {
        const data = await apiRequest('/api/dashboard/summary');

        document.getElementById('stat-total-items').textContent = formatNumber(data.total_items);
        document.getElementById('stat-total-locations').textContent = formatNumber(data.total_locations);
        document.getElementById('stat-pending-requests').textContent = formatNumber(data.pending_requests);

        const lowStockEl = document.getElementById('stat-low-stock');
        const lowStockCard = document.getElementById('stat-low-stock-card');
        lowStockEl.textContent = formatNumber(data.low_stock_count);
        if (data.low_stock_count > 0) {
            lowStockEl.classList.remove('text-emerald-400');
            lowStockEl.classList.add('text-red-400');
            lowStockCard.classList.add('border-red-500/40');
        }

        renderLowStock(data.low_stock_items);
        renderLocationTotals(data.location_totals);
        renderWastage(data.wastage_by_reason);
        renderRecentActivity(data.recent_logs);
    } catch (err) {
        showToast(err.message, 'error');
    }
})();

function renderLowStock(items) {
    const container = document.getElementById('low-stock-content');

    if (!items.length) {
        container.innerHTML = `
            <div class="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
                <svg class="w-5 h-5 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <p class="text-sm text-emerald-300">All stock levels are above their minimum thresholds.</p>
            </div>`;
        return;
    }

    const rows = items.map((item) => `
        <tr>
            <td class="font-medium text-white">${escapeHtml(item.name)}</td>
            <td>${escapeHtml(item.category)}</td>
            <td>${formatNumber(item.total_quantity)} ${escapeHtml(item.unit)}</td>
            <td>${formatNumber(item.min_stock_level)} ${escapeHtml(item.unit)}</td>
            <td><span class="badge badge-low">Below Minimum</span></td>
        </tr>
    `).join('');

    container.innerHTML = `
        <div class="table-wrap">
            <table class="data-table">
                <thead>
                    <tr><th>Item</th><th>Category</th><th>Current Stock</th><th>Min. Level</th><th>Status</th></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

function renderLocationTotals(locations) {
    const container = document.getElementById('location-totals-content');

    if (!locations.length) {
        container.innerHTML = '<p class="text-sm text-slate-500">No locations configured.</p>';
        return;
    }

    const max = Math.max(...locations.map((loc) => loc.total_quantity), 1);

    container.innerHTML = locations.map((loc) => {
        const pct = Math.max(2, Math.round((loc.total_quantity / max) * 100));
        return `
            <div>
                <div class="flex items-center justify-between mb-1.5">
                    <span class="text-sm font-medium text-slate-200">${escapeHtml(loc.name)}</span>
                    <span class="text-sm text-slate-400">${formatNumber(loc.total_quantity)} units</span>
                </div>
                <div class="progress-track">
                    <div class="progress-fill" style="width: ${pct}%"></div>
                </div>
            </div>`;
    }).join('');
}

const WASTAGE_BADGE_CLASS = {
    Damaged: 'badge-low',
    Scrap: 'badge-low',
    Lost: 'badge-low',
};

function renderWastage(wastage) {
    const container = document.getElementById('wastage-content');

    if (!wastage || !wastage.length) {
        container.innerHTML = '<p class="text-sm text-slate-500">No wastage data recorded yet.</p>';
        return;
    }

    container.innerHTML = wastage.map((w) => `
        <div class="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
            <div class="flex items-center justify-between mb-1.5">
                <span class="text-sm font-medium text-slate-200">${escapeHtml(w.reason)}</span>
                <span class="badge ${WASTAGE_BADGE_CLASS[w.reason] || 'badge-low'}">${escapeHtml(w.reason)}</span>
            </div>
            <p class="text-2xl font-bold text-white">${formatNumber(w.quantity)}</p>
            <p class="text-xs text-slate-500 mt-1">Total units logged as ${escapeHtml(w.reason.toLowerCase())} (Check-Out)</p>
        </div>
    `).join('');
}

function renderRecentActivity(logs) {
    const tbody = document.getElementById('recent-activity-body');

    if (!logs.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-slate-500">No activity recorded yet.</td></tr>';
        return;
    }

    tbody.innerHTML = logs.map((log) => `
        <tr>
            <td class="text-slate-400 whitespace-nowrap">${formatDateTime(log.timestamp)}</td>
            <td>${escapeHtml(log.user)}</td>
            <td>${escapeHtml(actionLabel(log.action))}</td>
            <td>${escapeHtml(log.item || '-')}</td>
            <td>${escapeHtml(log.location || (log.target_location ? '→ ' + log.target_location : '-'))}</td>
            <td>${log.quantity !== null && log.quantity !== undefined ? formatNumber(log.quantity) : '-'}</td>
            <td class="text-slate-400 max-w-xs truncate" title="${escapeHtml(log.notes)}">${escapeHtml(log.notes || '-')}</td>
        </tr>
    `).join('');
}
