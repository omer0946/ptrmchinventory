const ROLE = window.CURRENT_USER ? window.CURRENT_USER.role : 'Viewer';
const CAN_MANAGE_ASSETS = ['Admin', 'Storekeeper'].includes(ROLE);

let allAssignments = [];

document.addEventListener('DOMContentLoaded', () => {
    loadData();

    document.getElementById('search-input').addEventListener('input', renderTable);
    document.getElementById('return-form').addEventListener('submit', submitReturnForm);

    document.querySelectorAll('.modal-close').forEach((btn) => {
        btn.addEventListener('click', () => closeModal(btn.dataset.modal));
    });
});

async function loadData() {
    try {
        const registry = await apiRequest('/api/assets/registry');
        const usersWithAssets = (registry || []).filter((u) => u.active_assignments > 0);

        const details = await Promise.all(
            usersWithAssets.map((u) => apiRequest(`/api/assets/registry/${u.id}`))
        );

        allAssignments = details.flatMap((d) => d.active || []);
        renderTable();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function renderTable() {
    const tbody = document.getElementById('assets-table-body');
    const search = document.getElementById('search-input').value.trim().toLowerCase();

    const filtered = allAssignments.filter((a) => {
        return !search
            || (a.item_name && a.item_name.toLowerCase().includes(search))
            || (a.item_code && a.item_code.toLowerCase().includes(search))
            || (a.assigned_to && a.assigned_to.toLowerCase().includes(search));
    });

    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-slate-500 text-center py-6">No active asset assignments found.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map((a) => {
        return `
            <tr class="hover:bg-slate-800/40 transition-colors">
                <td class="text-slate-400 font-mono text-xs">${escapeHtml(a.item_code || '-')}</td>
                <td>
                    <p class="font-medium text-white">${escapeHtml(a.item_name)}</p>
                    <p class="text-xs text-slate-500">Qty: ${formatNumber(a.quantity)} ${escapeHtml(a.unit || '')} &middot; ${escapeHtml(a.location_name || '-')}</p>
                </td>
                <td class="text-indigo-300 font-medium">${escapeHtml(a.assigned_to || '-')}</td>
                <td class="text-slate-400 whitespace-nowrap text-sm">${formatDateTime(a.assigned_at)}</td>
                <td class="text-slate-500 text-sm">${escapeHtml(a.assigned_by || '-')}</td>
                <td><span class="badge border-indigo-400/50 text-indigo-400 bg-indigo-400/10">On Loan</span></td>
                <td class="text-right whitespace-nowrap">${renderActions(a)}</td>
            </tr>
        `;
    }).join('');

    attachActionHandlers();
}

function renderActions(assignment) {
    if (CAN_MANAGE_ASSETS) {
        return `
            <button class="btn btn-secondary btn-sm return-btn" data-id="${assignment.id}">
                Process Return
            </button>`;
    }
    return '<span class="text-slate-600">-</span>';
}

function attachActionHandlers() {
    document.querySelectorAll('.return-btn').forEach((btn) => {
        btn.addEventListener('click', () => openReturnModal(Number(btn.dataset.id)));
    });
}

function openReturnModal(assignmentId) {
    const assignment = allAssignments.find((a) => a.id === assignmentId);
    if (!assignment) return;

    document.getElementById('return-form').reset();
    document.getElementById('return-form-error').classList.add('hidden');

    document.getElementById('return-assignment-id').value = assignment.id;
    document.getElementById('return-item-name').textContent = `${assignment.item_name} (${assignment.item_code || 'No Code'}) - Qty: ${formatNumber(assignment.quantity)} ${assignment.unit || ''}`;
    document.getElementById('return-user-name').textContent = assignment.assigned_to;
    document.getElementById('return-location-name').textContent = assignment.location_name || '-';

    openModal('return-modal');
}

async function submitReturnForm(event) {
    event.preventDefault();
    const errorBox = document.getElementById('return-form-error');
    errorBox.classList.add('hidden');

    const assignmentId = document.getElementById('return-assignment-id').value;

    const payload = {
        condition: document.getElementById('return-condition').value,
        notes: document.getElementById('return-notes').value.trim(),
    };

    try {
        await apiRequest(`/api/assets/${assignmentId}/return`, { method: 'POST', body: payload });
        showToast('Asset return processed successfully', 'success');
        closeModal('return-modal');
        loadData();
    } catch (err) {
        errorBox.textContent = err.message;
        errorBox.classList.remove('hidden');
    }
}

function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}
