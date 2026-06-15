const ROLE = window.CURRENT_USER ? window.CURRENT_USER.role : 'Viewer';
const CURRENT_USER_ID = window.CURRENT_USER ? window.CURRENT_USER.id : null;

// New 4-Level RBAC Permissions
const CAN_MANAGE_STOCK = ['Admin', 'Storekeeper'].includes(ROLE);
const CAN_MANAGE_ITEMS = ['Admin'].includes(ROLE);

let allItems = [];
let allLocations = [];
let approvedUsers = []; // For asset assignment (Zimmet)

document.addEventListener('DOMContentLoaded', () => {
    loadInventory();

    document.getElementById('search-input').addEventListener('input', renderTable);
    document.getElementById('category-filter').addEventListener('change', renderTable);
    document.getElementById('location-filter').addEventListener('change', renderTable);
    document.getElementById('type-filter').addEventListener('change', renderTable);

    const addBtn = document.getElementById('add-item-btn');
    if (addBtn) addBtn.addEventListener('click', () => openItemModal(null));

    document.querySelectorAll('.modal-close').forEach((btn) => {
        btn.addEventListener('click', () => closeModal(btn.dataset.modal));
    });

    document.getElementById('item-form').addEventListener('submit', submitItemForm);
    document.getElementById('stock-form').addEventListener('submit', submitStockForm);
    document.getElementById('stock-location').addEventListener('change', updateStockLocationHint);
});

async function loadInventory() {
    try {
        // Fetch items/locations, and eligible personnel for asset assignment (Zimmet)
        const [itemsData, usersData] = await Promise.all([
            apiRequest('/api/items'),
            apiRequest('/api/assets/eligible-users').catch(() => []),
        ]);

        allItems = itemsData.items || [];
        allLocations = itemsData.locations || [];
        approvedUsers = Array.isArray(usersData) ? usersData : [];

        populateCategoryFilter();
        populateLocationFilter();
        renderTable();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function populateCategoryFilter() {
    const select = document.getElementById('category-filter');
    const current = select.value;
    const categories = [...new Set(allItems.map((item) => item.category).filter(Boolean))].sort();

    select.innerHTML = '<option value="">All Categories</option>' +
        categories.map((cat) => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join('');

    select.value = current;
}

function populateLocationFilter() {
    const select = document.getElementById('location-filter');
    const current = select.value;

    select.innerHTML = '<option value="">All Locations</option>' +
        allLocations.map((loc) => `<option value="${loc.id}">${escapeHtml(loc.name)}</option>`).join('');

    select.value = current;
}

/* --- Table Rendering ----------------------------------------------------- */

function renderTable() {
    const tbody = document.getElementById('inventory-table-body');
    const search = document.getElementById('search-input').value.trim().toLowerCase();
    const category = document.getElementById('category-filter').value;
    const locationId = document.getElementById('location-filter').value;
    const itemType = document.getElementById('type-filter').value;

    const filtered = allItems.filter((item) => {
        const matchesSearch = !search
            || item.name.toLowerCase().includes(search)
            || (item.item_code && item.item_code.toLowerCase().includes(search));
        const matchesCategory = !category || item.category === category;
        const matchesType = !itemType || item.item_type === itemType;
        const matchesLocation = !locationId || item.locations.some((l) => l.location_id === Number(locationId) && l.quantity > 0);
        return matchesSearch && matchesCategory && matchesLocation && matchesType;
    });

    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-slate-500 text-center py-6">No items match your filters.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map((item) => {
        const statusBadgeHtml = item.is_low_stock
            ? '<span class="badge badge-low">Critical</span>'
            : '<span class="badge badge-ok">OK</span>';

        const totalClass = item.is_low_stock ? 'font-semibold text-red-400' : 'font-semibold text-white';
        const typeBadgeClass = item.item_type === 'Fixed Asset' ? 'text-indigo-400 border-indigo-400/30 bg-indigo-400/10' : 'text-slate-400 border-slate-600 bg-slate-800';

        return `
            <tr class="hover:bg-slate-800/40 transition-colors ${item.is_low_stock ? 'bg-red-500/5' : ''}">
                <td class="text-slate-400 font-mono text-xs whitespace-nowrap">${escapeHtml(item.item_code || '-')}</td>
                <td class="font-medium text-white">${escapeHtml(item.name)}</td>
                <td><span class="border rounded-full px-2 py-0.5 text-xs ${typeBadgeClass}">${escapeHtml(item.item_type || 'Consumable')}</span></td>
                <td class="text-slate-400">${escapeHtml(item.category)}</td>
                <td class="text-slate-400">${escapeHtml(item.unit)}</td>
                <td class="${totalClass}">${formatNumber(item.total_quantity)}</td>
                <td>${statusBadgeHtml}</td>
                <td class="text-right whitespace-nowrap">${renderRowActions(item)}</td>
            </tr>
        `;
    }).join('');

    attachRowActionHandlers();
}

function renderRowActions(item) {
    const buttons = [];

    // Everyone can view the profile
    buttons.push(`
        <button class="btn-icon view-profile-btn" data-id="${item.id}" title="View Item Profile & Docs">
            <svg class="w-4 h-4 text-blue-400 hover:text-blue-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
        </button>`);

    if (CAN_MANAGE_STOCK) {
        buttons.push(`
            <button class="btn-icon check-in-btn" data-id="${item.id}" title="Check In">
                <svg class="w-4 h-4 text-emerald-400 hover:text-emerald-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            </button>`);
        buttons.push(`
            <button class="btn-icon check-out-btn" data-id="${item.id}" title="${item.item_type === 'Fixed Asset' ? 'Assign (Zimmet)' : 'Check Out'}">
                <svg class="w-4 h-4 text-amber-400 hover:text-amber-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 12h-15" /></svg>
            </button>`);
    }

    if (CAN_MANAGE_ITEMS) {
        buttons.push(`
            <button class="btn-icon edit-item-btn" data-id="${item.id}" title="Edit Item">
                <svg class="w-4 h-4 text-slate-400 hover:text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>
            </button>`);
        buttons.push(`
            <button class="btn-icon danger delete-item-btn" data-id="${item.id}" title="Delete Item">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
            </button>`);
    }

    return buttons.length ? `<div class="flex justify-end gap-1.5 items-center">${buttons.join('')}</div>` : '<span class="text-slate-600">-</span>';
}

function attachRowActionHandlers() {
    document.querySelectorAll('.view-profile-btn').forEach((btn) => {
        btn.addEventListener('click', () => openItemProfile(Number(btn.dataset.id)));
    });
    document.querySelectorAll('.check-in-btn').forEach((btn) => {
        btn.addEventListener('click', () => openStockModal(Number(btn.dataset.id), 'check-in'));
    });
    document.querySelectorAll('.check-out-btn').forEach((btn) => {
        btn.addEventListener('click', () => openStockModal(Number(btn.dataset.id), 'check-out'));
    });
    document.querySelectorAll('.edit-item-btn').forEach((btn) => {
        btn.addEventListener('click', () => openItemModal(Number(btn.dataset.id)));
    });
    document.querySelectorAll('.delete-item-btn').forEach((btn) => {
        btn.addEventListener('click', () => deleteItem(Number(btn.dataset.id)));
    });
}

/* --- Item Profile Modal (Read-Only) ----------------------------------- */

async function openItemProfile(itemId) {
    openModal('item-profile-modal');

    const locList = document.getElementById('profile-locations-list');
    const fileList = document.getElementById('profile-files-list');
    const historyBody = document.getElementById('profile-history-body');

    locList.innerHTML = '<li class="text-slate-500 text-xs">Loading...</li>';
    fileList.innerHTML = '<li class="text-slate-500 text-xs">Loading...</li>';
    historyBody.innerHTML = '<tr><td colspan="5" class="text-slate-500 text-center py-4">Loading history...</td></tr>';

    try {
        const data = await apiRequest(`/api/items/${itemId}/profile`);
        const item = data.item;

        // Populate Headers
        document.getElementById('profile-item-name').textContent = item.name;
        document.getElementById('profile-item-code').textContent = item.item_code || 'N/A';
        document.getElementById('profile-item-category').textContent = item.category || '-';

        const typeBadge = document.getElementById('profile-item-type');
        typeBadge.textContent = item.item_type || 'Consumable';
        typeBadge.className = item.item_type === 'Fixed Asset' ? 'badge border-indigo-400 text-indigo-400 bg-indigo-400/10' : 'badge';

        const unitNote = document.getElementById('profile-item-unit-note');
        if (item.unit_conversion_note) {
            unitNote.textContent = `Helper Note: ${item.unit_conversion_note}`;
            unitNote.classList.remove('hidden');
        } else {
            unitNote.classList.add('hidden');
        }

        // Populate Locations
        if (item.locations && item.locations.length > 0) {
            locList.innerHTML = item.locations.map(l => `
                <li class="flex justify-between items-center border-b border-slate-700/50 pb-1">
                    <span class="text-slate-300">${escapeHtml(l.location_name)}</span>
                    <span class="font-semibold ${l.quantity > 0 ? 'text-emerald-400' : 'text-slate-500'}">${formatNumber(l.quantity)} ${escapeHtml(item.unit)}</span>
                </li>
            `).join('');
        } else {
            locList.innerHTML = '<li class="text-slate-500 text-xs">No stock in any location.</li>';
        }

        // Populate Attachments
        const attachments = data.attachments || [];
        let filesHtml = '';
        if (attachments.length > 0) {
            filesHtml += attachments.map(f => `
                <li>
                    <a href="/static/${f.file_path}" target="_blank" class="flex items-center gap-2 text-blue-400 hover:text-blue-300 transition-colors">
                        <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 0119.5 7.372L8.552 18.32m.009-.01l-.01.01" /></svg>
                        <span class="truncate">${escapeHtml(f.original_filename)}</span>
                    </a>
                </li>
            `).join('');
        } else {
            filesHtml += '<li class="text-slate-500 text-xs">No documents attached.</li>';
        }

        // For Fixed Assets, show who currently holds it (Zimmet)
        if (item.item_type === 'Fixed Asset') {
            const active = (data.assignments || []).filter(a => !a.is_returned);
            if (active.length > 0) {
                filesHtml += `<li class="pt-2 mt-2 border-t border-slate-700/50 text-xs text-indigo-300">
                    Currently assigned to: ${active.map(a => escapeHtml(a.assigned_to)).join(', ')}
                </li>`;
            }
        }
        fileList.innerHTML = filesHtml;

        // Populate audit trail (logs)
        const logs = data.logs || [];
        if (logs.length > 0) {
            historyBody.innerHTML = logs.map(log => `
                <tr class="hover:bg-slate-800/40">
                    <td class="whitespace-nowrap text-xs text-slate-400">${formatDateTime(log.timestamp)}</td>
                    <td><span class="badge badge-pending">${escapeHtml(actionLabel(log.action))}</span></td>
                    <td class="font-medium text-white">${log.quantity !== null && log.quantity !== undefined ? formatNumber(log.quantity) : '-'}</td>
                    <td class="text-slate-300">${escapeHtml(log.user || '-')}</td>
                    <td class="text-xs text-slate-400 max-w-[200px] truncate" title="${escapeHtml(log.notes || '')}">
                        ${escapeHtml(log.notes || '-')}
                    </td>
                </tr>
            `).join('');
        } else {
            historyBody.innerHTML = '<tr><td colspan="5" class="text-slate-500 text-center py-4">No transactions found.</td></tr>';
        }
    } catch (err) {
        historyBody.innerHTML = `<tr><td colspan="5" class="text-red-400 text-center py-4">Failed to load history.</td></tr>`;
        showToast(err.message, 'error');
    }
}

/* --- Item Creation/Edit Modal ----------------------------------------- */

async function openItemModal(itemId) {
    const form = document.getElementById('item-form');
    form.reset();
    document.getElementById('item-form-error').classList.add('hidden');
    document.getElementById('existing-attachments').classList.add('hidden');
    document.getElementById('attachments-list').innerHTML = '';

    const item = itemId ? allItems.find((i) => i.id === itemId) : null;
    document.getElementById('item-id').value = item ? item.id : '';
    document.getElementById('item-modal-title').textContent = item ? 'Edit Item' : 'Add New Item';

    document.getElementById('item-code').value = item ? item.item_code : '';
    document.getElementById('item-type').value = item ? item.item_type : 'Consumable';
    document.getElementById('item-name').value = item ? item.name : '';
    document.getElementById('item-category').value = item ? item.category : '';
    document.getElementById('item-unit').value = item ? item.unit : '';
    document.getElementById('item-unit-note').value = item ? item.unit_conversion_note : '';
    document.getElementById('item-min-stock').value = item ? item.min_stock_level : 0;

    const initialStockSection = document.getElementById('initial-stock-section');
    const initialStockInputs = document.getElementById('initial-stock-inputs');

    if (item) {
        initialStockSection.classList.add('hidden');
    } else {
        initialStockSection.classList.remove('hidden');
        initialStockInputs.innerHTML = allLocations.map((loc) => `
            <div>
                <label class="label" for="initial-stock-${loc.id}">${escapeHtml(loc.name)}</label>
                <input type="number" id="initial-stock-${loc.id}" class="input" min="0" step="any" placeholder="0" value="0">
            </div>
        `).join('');
    }

    const locationMinStockInputs = document.getElementById('location-min-stock-inputs');
    locationMinStockInputs.innerHTML = allLocations.map((loc) => {
        const stock = item ? item.locations.find((l) => l.location_id === loc.id) : null;
        const currentMin = stock ? stock.min_stock_level : 0;
        return `
            <div>
                <label class="label" for="location-min-stock-${loc.id}">${escapeHtml(loc.name)}</label>
                <input type="number" id="location-min-stock-${loc.id}" class="input" min="0" step="any" placeholder="0" value="${currentMin}">
            </div>
        `;
    }).join('');

    openModal('item-modal');

    // Load existing attachments for editing (Item.to_dict() does not include them)
    if (item) {
        try {
            const profile = await apiRequest(`/api/items/${itemId}/profile`);
            renderExistingAttachments(itemId, profile.attachments || []);
        } catch (err) {
            // non-fatal: attachment list just stays empty
        }
    }
}

function renderExistingAttachments(itemId, attachments) {
    const container = document.getElementById('existing-attachments');
    const listEl = document.getElementById('attachments-list');

    if (!attachments.length) {
        container.classList.add('hidden');
        listEl.innerHTML = '';
        return;
    }

    listEl.innerHTML = attachments.map(f => `
        <li class="flex justify-between items-center gap-2 text-xs bg-slate-800 p-2 rounded">
            <a href="/static/${f.file_path}" target="_blank" class="truncate max-w-[250px] text-slate-300 hover:text-blue-400">${escapeHtml(f.original_filename)}</a>
            <button type="button" class="btn-icon danger delete-attachment-btn flex-shrink-0" data-item-id="${itemId}" data-attachment-id="${f.id}" title="Remove file">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
        </li>
    `).join('');
    container.classList.remove('hidden');

    listEl.querySelectorAll('.delete-attachment-btn').forEach((btn) => {
        btn.addEventListener('click', () => deleteAttachment(Number(btn.dataset.itemId), Number(btn.dataset.attachmentId)));
    });
}

async function deleteAttachment(itemId, attachmentId) {
    if (!confirm('Remove this file from the item?')) return;
    try {
        await apiRequest(`/api/items/${itemId}/attachments/${attachmentId}`, { method: 'DELETE' });
        const profile = await apiRequest(`/api/items/${itemId}/profile`);
        renderExistingAttachments(itemId, profile.attachments || []);
        showToast('File removed', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function submitItemForm(event) {
    event.preventDefault();
    const errorBox = document.getElementById('item-form-error');
    errorBox.classList.add('hidden');

    const itemId = document.getElementById('item-id').value;

    // Item create/update endpoints expect a JSON body
    const payload = {
        item_code: document.getElementById('item-code').value.trim(),
        item_type: document.getElementById('item-type').value,
        name: document.getElementById('item-name').value.trim(),
        category: document.getElementById('item-category').value.trim(),
        unit: document.getElementById('item-unit').value.trim(),
        unit_conversion_note: document.getElementById('item-unit-note').value.trim(),
        min_stock_level: Number(document.getElementById('item-min-stock').value) || 0,
    };

    if (!itemId) {
        const initialStock = {};
        const initialMinStock = {};
        allLocations.forEach((loc) => {
            const stkInput = document.getElementById(`initial-stock-${loc.id}`);
            const minInput = document.getElementById(`location-min-stock-${loc.id}`);
            initialStock[loc.id] = stkInput ? Number(stkInput.value) || 0 : 0;
            initialMinStock[loc.id] = minInput ? Number(minInput.value) || 0 : 0;
        });
        payload.initial_stock = initialStock;
        payload.initial_min_stock = initialMinStock;
    } else {
        const locationMinStock = {};
        allLocations.forEach((loc) => {
            const minInput = document.getElementById(`location-min-stock-${loc.id}`);
            locationMinStock[loc.id] = minInput ? Number(minInput.value) || 0 : 0;
        });
        payload.location_min_stock = locationMinStock;
    }

    try {
        let savedItem;
        if (itemId) {
            savedItem = await apiRequest(`/api/items/${itemId}`, { method: 'PUT', body: payload });
        } else {
            savedItem = await apiRequest('/api/items', { method: 'POST', body: payload });
        }

        // Upload any newly selected attachments via the dedicated endpoint
        const fileInput = document.getElementById('item-attachments');
        if (fileInput.files.length > 0) {
            const filesData = new FormData();
            for (let i = 0; i < fileInput.files.length; i++) {
                filesData.append('files', fileInput.files[i]);
            }
            try {
                await apiRequestForm(`/api/items/${savedItem.id}/attachments`, filesData);
            } catch (attachErr) {
                showToast(`Item saved, but file upload failed: ${attachErr.message}`, 'error');
            }
        }

        showToast(itemId ? 'Item updated successfully' : 'New item cataloged successfully', 'success');
        closeModal('item-modal');
        loadInventory();
    } catch (err) {
        errorBox.textContent = err.message;
        errorBox.classList.remove('hidden');
    }
}

async function deleteItem(itemId) {
    const item = allItems.find((i) => i.id === itemId);
    if (!item) return;
    if (!confirm(`Delete "${item.name}"? This removes the item and its history completely.`)) return;

    try {
        await apiRequest(`/api/items/${itemId}`, { method: 'DELETE' });
        showToast('Item deleted', 'success');
        loadInventory();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

/* --- Stock Movement (Check-in/Out & Zimmet) ---------------------------- */

function openStockModal(itemId, mode) {
    const item = allItems.find((i) => i.id === itemId);
    if (!item) return;

    document.getElementById('stock-form').reset();
    document.getElementById('stock-form-error').classList.add('hidden');
    document.getElementById('stock-item-id').value = item.id;
    document.getElementById('stock-mode').value = mode;

    document.getElementById('stock-item-name').textContent = `${item.name} (${item.unit})`;

    const typeBadge = document.getElementById('stock-item-type-badge');
    typeBadge.innerHTML = item.item_type === 'Fixed Asset'
        ? `<span class="badge border-indigo-400 text-indigo-400 bg-indigo-400/10">Fixed Asset (Demirbaş)</span>`
        : `<span class="badge border-slate-600 text-slate-400 bg-slate-800">Consumable</span>`;

    const locationSelect = document.getElementById('stock-location');
    locationSelect.innerHTML = allLocations.map((loc) => `<option value="${loc.id}">${escapeHtml(loc.name)}</option>`).join('');

    const title = document.getElementById('stock-modal-title');
    const submitBtn = document.getElementById('stock-submit-btn');

    const assignSection = document.getElementById('stock-assign-section');
    const assignSelect = document.getElementById('stock-assign-user');
    const reasonSection = document.getElementById('stock-reason-section');
    const heatBatchSection = document.getElementById('stock-heat-batch-section');

    if (mode === 'check-in') {
        title.textContent = 'Check In (Receive) Stock';
        submitBtn.textContent = 'Confirm Check In';
        submitBtn.className = 'btn btn-success';

        assignSection.classList.add('hidden');
        reasonSection.classList.add('hidden');
        heatBatchSection.classList.remove('hidden');

    } else {
        // CHECK-OUT LOGIC
        title.textContent = item.item_type === 'Fixed Asset' ? 'Assign Fixed Asset (Zimmet)' : 'Check Out Consumable';
        submitBtn.textContent = item.item_type === 'Fixed Asset' ? 'Confirm Assignment' : 'Confirm Check Out';
        submitBtn.className = item.item_type === 'Fixed Asset' ? 'btn bg-indigo-500 hover:bg-indigo-600 text-white' : 'btn btn-danger';

        heatBatchSection.classList.add('hidden');

        if (item.item_type === 'Fixed Asset') {
            // Require Assignment for Fixed Assets
            assignSection.classList.remove('hidden');
            reasonSection.classList.add('hidden');

            assignSelect.innerHTML = '<option value="">Select Approved Personnel...</option>' +
                approvedUsers.map(u => `<option value="${u.id}">${escapeHtml(u.full_name)} (${escapeHtml(u.username)})</option>`).join('');

        } else {
            // Standard reason for Consumables
            assignSection.classList.add('hidden');
            reasonSection.classList.remove('hidden');
            document.getElementById('stock-reason').value = 'Consumed';
        }
    }

    updateStockLocationHint();
    openModal('stock-modal');
}

function updateStockLocationHint() {
    const itemId = Number(document.getElementById('stock-item-id').value);
    const locationId = Number(document.getElementById('stock-location').value);
    const mode = document.getElementById('stock-mode').value;
    const hint = document.getElementById('stock-location-hint');

    const item = allItems.find((i) => i.id === itemId);
    if (!item) {
        hint.textContent = '';
        return;
    }

    const stock = item.locations.find((l) => l.location_id === locationId);
    const qty = stock ? stock.quantity : 0;

    if (mode === 'check-out') {
        hint.textContent = `Available at this location: ${formatNumber(qty)} ${item.unit}`;
        hint.className = qty > 0 ? 'text-xs text-emerald-400 mt-1' : 'text-xs text-red-400 mt-1 font-semibold';
    } else {
        hint.textContent = `Current stock at this location: ${formatNumber(qty)} ${item.unit}`;
        hint.className = 'text-xs text-slate-500 mt-1';
    }
}

async function submitStockForm(event) {
    event.preventDefault();
    const errorBox = document.getElementById('stock-form-error');
    errorBox.classList.add('hidden');

    const itemId = Number(document.getElementById('stock-item-id').value);
    const item = allItems.find((i) => i.id === itemId);
    const mode = document.getElementById('stock-mode').value;

    const locationId = document.getElementById('stock-location').value;
    const quantity = document.getElementById('stock-quantity').value;
    const notes = document.getElementById('stock-notes').value.trim();

    try {
        if (mode === 'check-in') {
            const formData = new FormData();
            formData.append('location_id', locationId);
            formData.append('quantity', quantity);
            formData.append('notes', notes);
            formData.append('heat_number', document.getElementById('stock-heat-number').value.trim());
            formData.append('batch_number', document.getElementById('stock-batch-number').value.trim());

            await apiRequestForm(`/api/items/${itemId}/check-in`, formData);
            showToast('Stock checked in successfully', 'success');
        } else if (item.item_type === 'Fixed Asset') {
            // Zimmet: Fixed Assets are assigned to a registered user, not regular check-out
            const assigneeId = document.getElementById('stock-assign-user').value;
            if (!assigneeId) throw new Error('You must select an approved user to assign this fixed asset.');

            await apiRequest('/api/assets/assign', {
                method: 'POST',
                body: {
                    item_id: itemId,
                    location_id: Number(locationId),
                    assigned_to_id: Number(assigneeId),
                    quantity,
                    notes,
                },
            });
            showToast('Asset assigned successfully', 'success');
        } else {
            const payload = {
                location_id: Number(locationId),
                quantity,
                notes,
                reason: document.getElementById('stock-reason').value,
            };

            const result = await apiRequest(`/api/items/${itemId}/check-out`, { method: 'POST', body: payload });
            showToast('Stock checked out', 'success');

            // Print Slip
            if (result.log_id) {
                window.open(`/logs/${result.log_id}/slip`, '_blank');
            }
        }

        closeModal('stock-modal');
        loadInventory();
    } catch (err) {
        errorBox.textContent = err.message;
        errorBox.classList.remove('hidden');
    }
}

/* --- Utilities ---------------------------------------------------------- */

function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
    document.getElementById(id).classList.add('flex');
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
    document.getElementById(id).classList.remove('flex');
}
