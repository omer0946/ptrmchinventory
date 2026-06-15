const ROLE = window.CURRENT_USER.role;

let allItems = [];
let allLocations = [];

document.addEventListener('DOMContentLoaded', () => {
    if (ROLE !== 'Admin' && ROLE !== 'Storekeeper') {
        document.querySelector('main').innerHTML = `
            <div class="card p-6">
                <p class="text-sm text-slate-400">You do not have permission to access this page.</p>
            </div>`;
        return;
    }

    loadFormData();
    loadRecentTransfers();

    document.getElementById('transfer-item').addEventListener('change', updateFromStockHint);
    document.getElementById('transfer-from').addEventListener('change', updateFromStockHint);
    document.getElementById('transfer-form').addEventListener('submit', submitTransfer);
});

async function loadFormData() {
    try {
        const data = await apiRequest('/api/items');
        allItems = data.items;
        allLocations = data.locations;

        const itemSelect = document.getElementById('transfer-item');
        const selectedItem = itemSelect.value;
        itemSelect.innerHTML = '<option value="">Select item...</option>' +
            allItems.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
        itemSelect.value = selectedItem;

        const locationOptions = allLocations.map((loc) => `<option value="${loc.id}">${escapeHtml(loc.name)}</option>`).join('');

        const fromSelect = document.getElementById('transfer-from');
        const selectedFrom = fromSelect.value;
        fromSelect.innerHTML = '<option value="">Select source location...</option>' + locationOptions;
        fromSelect.value = selectedFrom;

        const toSelect = document.getElementById('transfer-to');
        const selectedTo = toSelect.value;
        toSelect.innerHTML = '<option value="">Select destination location...</option>' + locationOptions;
        toSelect.value = selectedTo;

        applyTransferPrefill();
        updateFromStockHint();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function applyTransferPrefill() {
    const raw = sessionStorage.getItem('transferPrefill');
    if (!raw) return;
    sessionStorage.removeItem('transferPrefill');

    let prefill;
    try {
        prefill = JSON.parse(raw);
    } catch (err) {
        return;
    }

    if (prefill.item_id) document.getElementById('transfer-item').value = prefill.item_id;
    if (prefill.from_location_id) document.getElementById('transfer-from').value = prefill.from_location_id;
    if (prefill.to_location_id) document.getElementById('transfer-to').value = prefill.to_location_id;
    if (prefill.quantity !== undefined && prefill.quantity !== null) {
        document.getElementById('transfer-quantity').value = prefill.quantity;
    }

    showToast('Transfer pre-filled from critical stock alert — review and submit.', 'info');
}

function updateFromStockHint() {
    const itemId = Number(document.getElementById('transfer-item').value);
    const locationId = Number(document.getElementById('transfer-from').value);
    const hint = document.getElementById('transfer-from-stock');

    const item = allItems.find((i) => i.id === itemId);
    if (!item || !locationId) {
        hint.textContent = '';
        return;
    }

    const stock = item.locations.find((l) => l.location_id === locationId);
    const qty = stock ? stock.quantity : 0;
    hint.textContent = `Available at this location: ${formatNumber(qty)} ${item.unit}`;
}

async function submitTransfer(event) {
    event.preventDefault();
    const errorBox = document.getElementById('transfer-form-error');
    errorBox.classList.add('hidden');

    const payload = {
        item_id: Number(document.getElementById('transfer-item').value),
        from_location_id: Number(document.getElementById('transfer-from').value),
        to_location_id: Number(document.getElementById('transfer-to').value),
        quantity: document.getElementById('transfer-quantity').value,
        notes: document.getElementById('transfer-notes').value.trim(),
        heat_number: document.getElementById('transfer-heat-number').value.trim(),
        batch_number: document.getElementById('transfer-batch-number').value.trim(),
    };

    try {
        const result = await apiRequest('/api/transfers', { method: 'POST', body: payload });
        showToast('Stock transferred successfully', 'success');
        document.getElementById('transfer-form').reset();
        await loadFormData();
        await loadRecentTransfers();
        if (result.log_id) {
            window.open(`/logs/${result.log_id}/slip`, '_blank');
        }
    } catch (err) {
        errorBox.textContent = err.message;
        errorBox.classList.remove('hidden');
    }
}

async function loadRecentTransfers() {
    const tbody = document.getElementById('transfers-table-body');
    try {
        const logs = await apiRequest('/api/logs?action=TRANSFER');
        if (!logs.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-slate-500">No transfers recorded yet.</td></tr>';
            return;
        }
        tbody.innerHTML = logs.slice(0, 50).map((log) => `
            <tr>
                <td class="text-slate-400 whitespace-nowrap">${formatDateTime(log.timestamp)}</td>
                <td class="font-medium text-white">${escapeHtml(log.item || '-')}</td>
                <td>${escapeHtml(log.location || '-')}</td>
                <td>${escapeHtml(log.target_location || '-')}</td>
                <td>${formatNumber(log.quantity)}</td>
                <td class="text-slate-400">${escapeHtml(log.user)}</td>
            </tr>
        `).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-red-400">${escapeHtml(err.message)}</td></tr>`;
    }
}
