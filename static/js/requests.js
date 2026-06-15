const ROLE = window.CURRENT_USER.role;
const CURRENT_USER_ID = window.CURRENT_USER.id;

// Permission Checks
const CAN_CREATE_REQUEST = ['Admin', 'Manager', 'Storekeeper'].includes(ROLE);
const CAN_TRANSFER = ['Admin', 'Storekeeper'].includes(ROLE);
const CAN_RECEIVE_LINES = ['Admin', 'Storekeeper'].includes(ROLE); // Only warehouse roles can physically receive goods
const CAN_APPROVE_REJECT = ['Admin', 'Manager'].includes(ROLE); // Only managers/admins can approve MRFs

let allRequests = [];
let allItems = [];
let allLocations = [];

document.addEventListener('DOMContentLoaded', () => {
    loadData();

    document.getElementById('status-filter').addEventListener('change', renderRequestsTable);

    const newBtn = document.getElementById('new-request-btn');
    if (newBtn) newBtn.addEventListener('click', () => openRequestModal(null, false));

    document.getElementById('add-line-btn').addEventListener('click', () => addRequestLine(null, false));

    document.querySelectorAll('.modal-close').forEach((btn) => {
        btn.addEventListener('click', () => closeModal(btn.dataset.modal));
    });

    document.getElementById('request-form').addEventListener('submit', submitRequestForm);
    
    // Attach handlers for inside-modal Manager actions
    const approveBtn = document.getElementById('approve-request-btn');
    if(approveBtn) approveBtn.addEventListener('click', () => reviewRequestFromModal('approve'));
    
    const rejectBtn = document.getElementById('reject-request-btn');
    if(rejectBtn) rejectBtn.addEventListener('click', () => reviewRequestFromModal('reject'));
});

async function loadData() {
    try {
        const [requests, itemsData] = await Promise.all([
            apiRequest('/api/requests'),
            apiRequest('/api/items'),
        ]);
        allRequests = requests;
        allItems = itemsData.items;
        allLocations = itemsData.locations;
        renderRequestsTable();
        renderCriticalAlerts();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

/* --- Critical stock alerts (per location) -------------------------------- */

function computeCriticalAlerts() {
    const alerts = [];

    allItems.forEach((item) => {
        item.locations.forEach((loc) => {
            if (!loc.is_low_stock) return;

            const deficit = loc.min_stock_level - loc.quantity;

            let bestSource = null;
            let bestSurplus = 0;
            item.locations.forEach((other) => {
                if (other.location_id === loc.location_id) return;
                const surplus = Math.max(other.quantity - (other.min_stock_level || 0), 0);
                if (surplus > bestSurplus) {
                    bestSurplus = surplus;
                    bestSource = other;
                }
            });

            const recommendation = bestSource
                ? {
                    type: 'transfer',
                    source_location_id: bestSource.location_id,
                    source_location_name: bestSource.location_name,
                    suggested_qty: Math.min(deficit, bestSurplus),
                }
                : { type: 'purchase', suggested_qty: deficit };

            alerts.push({
                item_id: item.id,
                item_name: item.name,
                unit: item.unit,
                location_id: loc.location_id,
                location_name: loc.location_name,
                quantity: loc.quantity,
                min_stock_level: loc.min_stock_level,
                deficit,
                recommendation,
            });
        });
    });

    return alerts;
}

function renderCriticalAlerts() {
    const tbody = document.getElementById('critical-alerts-body');
    const countBadge = document.getElementById('critical-alerts-count');
    const alerts = computeCriticalAlerts();

    if (!alerts.length) {
        countBadge.classList.add('hidden');
        tbody.innerHTML = '<tr><td colspan="7" class="text-slate-500 text-center py-4">No critical alerts &mdash; all locations meet their minimum stock levels.</td></tr>';
        return;
    }

    countBadge.textContent = `${alerts.length} critical`;
    countBadge.classList.remove('hidden');

    tbody.innerHTML = alerts.map((alert) => {
        const recText = alert.recommendation.type === 'transfer'
            ? `Transfer ${formatNumber(alert.recommendation.suggested_qty)} ${alert.unit} from ${escapeHtml(alert.recommendation.source_location_name)}`
            : `Purchase ${formatNumber(alert.recommendation.suggested_qty)} ${alert.unit} (no surplus elsewhere)`;

        let actionBtn = '<span class="text-slate-600">-</span>';
        if (alert.recommendation.type === 'transfer' && CAN_TRANSFER) {
            actionBtn = `<button class="btn btn-secondary btn-sm create-transfer-btn"
                data-item-id="${alert.item_id}"
                data-from="${alert.recommendation.source_location_id}"
                data-to="${alert.location_id}"
                data-qty="${alert.recommendation.suggested_qty}">Create Transfer</button>`;
        } else if (alert.recommendation.type === 'purchase' && CAN_CREATE_REQUEST) {
            actionBtn = `<button class="btn btn-secondary btn-sm add-to-request-btn"
                data-item-id="${alert.item_id}"
                data-location-id="${alert.location_id}"
                data-qty="${alert.deficit}">Add to Request</button>`;
        }

        return `
            <tr class="bg-red-500/5 hover:bg-red-500/10 transition-colors">
                <td class="font-medium text-white">${escapeHtml(alert.item_name)}</td>
                <td>${escapeHtml(alert.location_name)}</td>
                <td class="text-red-400 font-semibold">${formatNumber(alert.quantity)}</td>
                <td class="text-slate-400">${formatNumber(alert.min_stock_level)}</td>
                <td class="text-red-400">${formatNumber(alert.deficit)}</td>
                <td class="text-slate-300">${recText}</td>
                <td class="text-right whitespace-nowrap">${actionBtn}</td>
            </tr>
        `;
    }).join('');

    document.querySelectorAll('.create-transfer-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            sessionStorage.setItem('transferPrefill', JSON.stringify({
                item_id: Number(btn.dataset.itemId),
                from_location_id: Number(btn.dataset.from),
                to_location_id: Number(btn.dataset.to),
                quantity: btn.dataset.qty,
            }));
            window.location.href = '/transfers';
        });
    });

    document.querySelectorAll('.add-to-request-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            openRequestModal(null, false, {
                target_location_id: Number(btn.dataset.locationId),
                lines: [{ item_id: Number(btn.dataset.itemId), quantity: btn.dataset.qty }],
            });
        });
    });
}

async function loadRequests() {
    try {
        allRequests = await apiRequest('/api/requests');
        renderRequestsTable();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

/* --- Receiving deliveries against approved MRFs -------------------------- */

async function receiveLine(requestId, lineId, receivedQuantity) {
    try {
        const updated = await apiRequest(`/api/requests/${requestId}/lines/${lineId}/receive`, {
            method: 'POST',
            body: { received_quantity: receivedQuantity },
        });
        showToast('Shipment quantity received & logged.', 'success');

        const idx = allRequests.findIndex((r) => r.id === updated.id);
        if (idx !== -1) allRequests[idx] = updated;
        renderRequestsTable();

        await refreshItemsData();
        
        // Re-open modal in view mode to show updated progress
        openRequestModal(updated.id, true);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function refreshItemsData() {
    try {
        const itemsData = await apiRequest('/api/items');
        allItems = itemsData.items;
        allLocations = itemsData.locations;
        renderCriticalAlerts();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

/* --- Table -------------------------------------------------------------- */

function renderRequestsTable() {
    const tbody = document.getElementById('requests-table-body');
    const statusFilter = document.getElementById('status-filter').value;

    const filtered = statusFilter ? allRequests.filter((r) => r.status === statusFilter) : allRequests;

    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-slate-500 text-center py-6">No material requests found.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map((req) => {
        const itemsSummary = req.lines
            .map((l) => `${l.material_name}${l.is_new_item ? ' (New)' : ''} (${formatNumber(l.received_quantity)}/${formatNumber(l.requested_quantity)} ${l.unit})`)
            .join(', ');

        return `
            <tr class="hover:bg-slate-800/50 transition-colors">
                <td class="text-slate-400 font-mono text-xs">#${req.id}</td>
                <td class="font-medium text-white">${escapeHtml(req.requester)}</td>
                <td>${escapeHtml(req.target_location)}</td>
                <td class="max-w-xs truncate text-slate-300" title="${escapeHtml(itemsSummary)}">${escapeHtml(itemsSummary || '-')}</td>
                <td>${statusBadge(req.status)}</td>
                <td>${statusBadge(req.delivery_status)}</td>
                <td class="text-slate-400 whitespace-nowrap text-sm">${formatDateTime(req.created_at)}</td>
                <td class="text-slate-400">${escapeHtml(req.reviewed_by || '-')}</td>
                <td class="text-right whitespace-nowrap">${renderRequestActions(req)}</td>
            </tr>
        `;
    }).join('');

    attachRequestActionHandlers();
}

function renderRequestActions(req) {
    const buttons = [];

    // Everyone can view details
    buttons.push(`
        <button class="btn-icon view-request-btn" data-id="${req.id}" title="View Details / Receive Items">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
        </button>`);

    // Only editable if Pending. Requesters can edit their own, Admins/Managers can edit all.
    const canEdit = req.status === 'Pending' && 
                    (ROLE === 'Admin' || ROLE === 'Manager' || (ROLE === 'Storekeeper' && req.requester_id === CURRENT_USER_ID));
    
    if (canEdit) {
        buttons.push(`
            <button class="btn-icon edit-request-btn" data-id="${req.id}" title="Edit Request">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>
            </button>`);
    }

    // Direct table action buttons for quick Approval/Rejection
    if (CAN_APPROVE_REJECT && req.status === 'Pending') {
        buttons.push(`
            <button class="btn-icon approve-request-btn" data-id="${req.id}" title="Approve MRF">
                <svg class="w-4 h-4 text-emerald-400 hover:text-emerald-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
            </button>`);
        buttons.push(`
            <button class="btn-icon reject-request-btn" data-id="${req.id}" title="Reject MRF">
                <svg class="w-4 h-4 text-red-400 hover:text-red-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>`);
    }

    if (ROLE === 'Admin') {
        buttons.push(`
            <button class="btn-icon danger delete-request-btn" data-id="${req.id}" title="Delete Permanently">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
            </button>`);
    }

    return `<div class="flex justify-end gap-1.5 items-center">${buttons.join('')}</div>`;
}

function attachRequestActionHandlers() {
    document.querySelectorAll('.view-request-btn').forEach((btn) => {
        btn.addEventListener('click', () => openRequestModal(Number(btn.dataset.id), true));
    });
    document.querySelectorAll('.edit-request-btn').forEach((btn) => {
        btn.addEventListener('click', () => openRequestModal(Number(btn.dataset.id), false));
    });
    document.querySelectorAll('.approve-request-btn').forEach((btn) => {
        btn.addEventListener('click', () => reviewRequest(Number(btn.dataset.id), 'approve'));
    });
    document.querySelectorAll('.reject-request-btn').forEach((btn) => {
        btn.addEventListener('click', () => reviewRequest(Number(btn.dataset.id), 'reject'));
    });
    document.querySelectorAll('.delete-request-btn').forEach((btn) => {
        btn.addEventListener('click', () => deleteRequest(Number(btn.dataset.id)));
    });
}

/* --- Modal Logic ---------------------------------------------------------- */

function openRequestModal(requestId, readonly, prefill) {
    const form = document.getElementById('request-form');
    form.reset();
    document.getElementById('request-form-error').classList.add('hidden');
    document.getElementById('request-lines-container').innerHTML = '';

    const req = requestId ? allRequests.find((r) => r.id === requestId) : null;
    document.getElementById('request-id').value = req ? req.id : '';

    const locationSelect = document.getElementById('request-location');
    locationSelect.innerHTML = allLocations.map((loc) => `<option value="${loc.id}">${escapeHtml(loc.name)}</option>`).join('');
    
    if (req) {
        locationSelect.value = req.target_location_id;
    } else if (prefill && prefill.target_location_id) {
        locationSelect.value = prefill.target_location_id;
    }
    locationSelect.disabled = readonly;

    const notesField = document.getElementById('request-notes');
    notesField.value = req ? req.notes : '';
    notesField.disabled = readonly;

    // Only allow receiving if form is Approved AND user is a Storekeeper/Admin
    const isApprovedForm = req && req.status === 'Approved';
    const canReceiveInModal = readonly && CAN_RECEIVE_LINES && isApprovedForm;

    // Populate lines
    if (req && req.lines.length) {
        req.lines.forEach((line) => addRequestLine(line, readonly, canReceiveInModal));
    } else if (prefill && prefill.lines && prefill.lines.length) {
        prefill.lines.forEach((line) => addRequestLine(line, readonly, false));
    } else {
        addRequestLine(null, readonly, false);
    }

    // UI Toggles
    const title = document.getElementById('request-modal-title');
    const submitBtn = document.querySelector('#request-form button[type="submit"]');
    const cancelBtn = document.querySelector('#request-form .modal-close');
    const addLineBtn = document.getElementById('add-line-btn');
    const managerActionsDiv = document.getElementById('manager-actions');

    addLineBtn.classList.toggle('hidden', readonly);

    // Manager Actions inside Modal
    if (req && req.status === 'Pending' && CAN_APPROVE_REJECT && readonly) {
        managerActionsDiv.classList.remove('hidden');
        managerActionsDiv.classList.add('flex');
    } else {
        managerActionsDiv.classList.add('hidden');
        managerActionsDiv.classList.remove('flex');
    }

    if (readonly) {
        title.innerHTML = `Material Request Form <span class="text-slate-400 font-mono text-sm ml-2">#${req.id}</span>`;
        submitBtn.classList.add('hidden');
        cancelBtn.textContent = 'Close window';
    } else {
        title.textContent = req ? `Edit Material Request #${req.id}` : 'Create Material Request Form';
        submitBtn.classList.remove('hidden');
        cancelBtn.textContent = 'Cancel';
    }

    openModal('request-modal');
}

function addRequestLine(line, readonly, canReceiveInModal) {
    const template = document.getElementById('request-line-template');
    const clone = template.content.cloneNode(true);
    const container = document.getElementById('request-lines-container');

    const select = clone.querySelector('.request-line-item');
    
    // Sort items alphabetically for easier selection
    const sortedItems = [...allItems].sort((a,b) => a.name.localeCompare(b.name));
    
    select.innerHTML = '<option value="">Select item from catalog...</option>' +
        sortedItems.map((item) => `<option value="${item.id}">${escapeHtml(item.name)} (${escapeHtml(item.unit)})</option>`).join('') +
        '<option value="__new__" class="font-bold text-emerald-400">+ Register New Custom Material...</option>';

    const qtyInput = clone.querySelector('.request-line-qty');
    const stockHint = clone.querySelector('.request-line-stock-hint');
    const newFields = clone.querySelector('.request-line-new-fields');
    const newNameInput = clone.querySelector('.request-line-new-name');
    const newCategoryInput = clone.querySelector('.request-line-new-category');
    const newUnitInput = clone.querySelector('.request-line-new-unit');
    const removeBtn = clone.querySelector('.remove-line-btn');

    if (line) {
        // Backend lines use `requested_quantity`; prefill lines (from Critical Alerts) use `quantity`
        const qtyValue = (line.requested_quantity !== undefined && line.requested_quantity !== null)
            ? line.requested_quantity
            : line.quantity;
        if (qtyValue !== undefined && qtyValue !== null && qtyValue !== '') {
            qtyInput.value = qtyValue;
        }

        if (line.is_new_item) {
            select.value = '__new__';
            newFields.classList.remove('hidden');
            newNameInput.value = line.material_name || '';
            newCategoryInput.value = line.category || '';
            newUnitInput.value = line.unit || '';
        } else if (line.item_id) {
            select.value = line.item_id;
        }
    }

    updateLineStockHint(select, stockHint);

    select.addEventListener('change', () => {
        if (select.value === '__new__') {
            newFields.classList.remove('hidden');
            stockHint.textContent = '';
        } else {
            newFields.classList.add('hidden');
            updateLineStockHint(select, stockHint);
        }
    });

    if (readonly) {
        select.disabled = true;
        qtyInput.disabled = true;
        newNameInput.disabled = true;
        newCategoryInput.disabled = true;
        newUnitInput.disabled = true;
        removeBtn.classList.add('hidden');
    } else {
        removeBtn.addEventListener('click', () => {
            const lineEl = removeBtn.closest('.request-line');
            const allLines = container.querySelectorAll('.request-line');
            if (allLines.length > 1) {
                lineEl.remove();
            } else {
                showToast("You must have at least one material line.", "error");
            }
        });
    }

    // Handle Partial Receiving UI
    if (canReceiveInModal && line && line.id && !line.is_new_item) {
        const receiveSection = clone.querySelector('.request-line-receive');
        const requestedDisplay = clone.querySelector('.request-line-requested-display');
        const receivedDisplay = clone.querySelector('.request-line-received-display');
        const statusBadgeEl = clone.querySelector('.request-line-status-badge');
        
        // Setup display values
        receiveSection.classList.remove('hidden');
        receiveSection.classList.add('flex');
        
        requestedDisplay.textContent = `${formatNumber(line.requested_quantity)} ${line.unit}`;
        receivedDisplay.textContent = `${formatNumber(line.received_quantity)}`;
        statusBadgeEl.innerHTML = statusBadge(line.line_status);

        // If not completely received, show the input to log more items
        const actionContainer = clone.querySelector('.src-action-container');
        
        if (actionContainer) {
            if (line.line_status === 'Fully Received') {
                actionContainer.classList.add('hidden');
            } else {
                const receiveInput = clone.querySelector('.request-line-receive-input');
                const receiveBtn = clone.querySelector('.request-line-receive-btn');
                
                // Calculate max allowable to prevent over-receiving
                const maxAllowed = line.requested_quantity - line.received_quantity;
                receiveInput.max = maxAllowed;
                receiveInput.placeholder = `Max: ${maxAllowed}`;

                receiveBtn.addEventListener('click', () => {
                    const addedQty = Number(receiveInput.value);
                    if (Number.isNaN(addedQty) || addedQty <= 0) {
                        showToast("Enter a valid quantity to receive", "error");
                        return;
                    }
                    if (addedQty > maxAllowed) {
                        showToast(`Cannot receive more than requested. Max allowed: ${maxAllowed}`, "error");
                        return;
                    }
                    receiveLine(document.getElementById('request-id').value, line.id, (line.received_quantity + addedQty));
                });
            }
        }
    }

    container.appendChild(clone);
}

function updateLineStockHint(select, hintEl) {
    const itemId = Number(select.value);
    if (!itemId) {
        hintEl.textContent = '';
        return;
    }

    const item = allItems.find((i) => i.id === itemId);
    if (!item) {
        hintEl.textContent = '';
        return;
    }

    const lowNote = item.is_low_stock ? ' — Critical Level' : '';
    hintEl.textContent = `Current catalog stock: ${formatNumber(item.total_quantity)} ${item.unit} (Minimum: ${formatNumber(item.min_stock_level)})${lowNote}`;
    hintEl.className = `request-line-stock-hint text-xs mt-1 ${item.is_low_stock ? 'text-red-400 font-medium' : 'text-slate-500'}`;
}

async function submitRequestForm(event) {
    event.preventDefault();
    const errorBox = document.getElementById('request-form-error');
    errorBox.classList.add('hidden');

    const requestId = document.getElementById('request-id').value;
    const lines = [];
    let lineError = null;

    document.querySelectorAll('#request-lines-container .request-line').forEach((row) => {
        if (lineError) return;

        const itemValue = row.querySelector('.request-line-item').value;
        const quantity = row.querySelector('.request-line-qty').value;
        
        if (!itemValue || !quantity) return;

        if (itemValue === '__new__') {
            const newName = row.querySelector('.request-line-new-name').value.trim();
            const newCategory = row.querySelector('.request-line-new-category').value.trim();
            const newUnit = row.querySelector('.request-line-new-unit').value.trim();
            if (!newName || !newCategory || !newUnit) {
                lineError = 'Please fill in the Name, Category, and Unit for all custom items.';
                return;
            }
            lines.push({ new_item_name: newName, new_item_category: newCategory, new_item_unit: newUnit, quantity: Number(quantity) });
        } else {
            lines.push({ item_id: Number(itemValue), quantity: Number(quantity) });
        }
    });

    if (lineError) {
        errorBox.textContent = lineError;
        errorBox.classList.remove('hidden');
        return;
    }

    if (!lines.length) {
        errorBox.textContent = 'Please add at least one material line with a quantity.';
        errorBox.classList.remove('hidden');
        return;
    }

    const payload = {
        target_location_id: Number(document.getElementById('request-location').value),
        notes: document.getElementById('request-notes').value.trim(),
        lines,
    };

    try {
        if (requestId) {
            await apiRequest(`/api/requests/${requestId}`, { method: 'PUT', body: payload });
            showToast('Request Form updated successfully', 'success');
        } else {
            await apiRequest('/api/requests', { method: 'POST', body: payload });
            showToast('Material Request Form submitted successfully', 'success');
        }
        closeModal('request-modal');
        loadRequests();
    } catch (err) {
        errorBox.textContent = err.message;
        errorBox.classList.remove('hidden');
    }
}

/* --- Approval workflow ----------------------------------------------------- */

// Helper to handle Manager approval directly from the open modal
function reviewRequestFromModal(action) {
    const requestId = document.getElementById('request-id').value;
    if(requestId) {
        reviewRequest(Number(requestId), action);
        closeModal('request-modal');
    }
}

async function reviewRequest(requestId, action) {
    const verb = action === 'approve' ? 'Approve' : 'Reject';
    if (!confirm(`Are you sure you want to ${verb} MRF #${requestId}?`)) return;

    try {
        await apiRequest(`/api/requests/${requestId}/${action}`, { method: 'POST' });
        showToast(`MRF #${requestId} has been ${action === 'approve' ? 'Approved' : 'Rejected'}`, 'success');
        loadRequests();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function deleteRequest(requestId) {
    if (!confirm(`Permanently delete MRF #${requestId}? This cannot be undone.`)) return;

    try {
        await apiRequest(`/api/requests/${requestId}`, { method: 'DELETE' });
        showToast('Request deleted permanently', 'success');
        loadRequests();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

/* --- Modal helpers ---------------------------------------------------------- */

function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
    document.getElementById(id).classList.add('flex');
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
    document.getElementById(id).classList.remove('flex');
}