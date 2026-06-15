/**
 * Shared helpers: API requests, toasts, formatting.
 */

const STATUS_BADGE_CLASS = {
    Pending: 'badge-pending',
    Approved: 'badge-approved',
    Rejected: 'badge-rejected',
    'Pending Approval': 'badge-pending',
    'Partially Received': 'badge-pending',
    'Fully Received': 'badge-approved',
};

const ACTION_LABELS = {
    CHECK_IN: 'Check In',
    CHECK_OUT: 'Check Out',
    TRANSFER: 'Transfer',
    ITEM_CREATED: 'Item Created',
    ITEM_UPDATED: 'Item Updated',
    ITEM_DELETED: 'Item Deleted',
    REQUEST_CREATED: 'Request Created',
    REQUEST_UPDATED: 'Request Updated',
    REQUEST_APPROVED: 'Request Approved',
    REQUEST_REJECTED: 'Request Rejected',
    REQUEST_DELETED: 'Request Deleted',
    ASSET_ASSIGNED: 'Asset Assigned',
    ASSET_RETURNED: 'Asset Returned',
};

async function apiRequest(url, { method = 'GET', body } = {}) {
    const options = {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
    };
    if (body !== undefined) {
        options.body = JSON.stringify(body);
    }

    const res = await fetch(url, options);

    if (res.status === 401) {
        window.location.href = '/login';
        throw new Error('Authentication required');
    }

    let data = null;
    try {
        data = await res.json();
    } catch (err) {
        data = null;
    }

    if (!res.ok) {
        const message = (data && data.error) || `Request failed (${res.status})`;
        throw new Error(message);
    }

    return data;
}

/**
 * Like apiRequest, but sends a FormData body (multipart/form-data) so file
 * inputs can be included. The browser sets the Content-Type/boundary itself.
 */
async function apiRequestForm(url, formData, { method = 'POST' } = {}) {
    const res = await fetch(url, {
        method,
        body: formData,
        credentials: 'same-origin',
    });

    if (res.status === 401) {
        window.location.href = '/login';
        throw new Error('Authentication required');
    }

    let data = null;
    try {
        data = await res.json();
    } catch (err) {
        data = null;
    }

    if (!res.ok) {
        const message = (data && data.error) || `Request failed (${res.status})`;
        throw new Error(message);
    }

    return data;
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.2s ease';
        setTimeout(() => toast.remove(), 200);
    }, 4000);
}

function formatNumber(value) {
    const num = Number(value) || 0;
    return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function formatDateTime(iso) {
    if (!iso) return '-';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

function statusBadge(status) {
    const cls = STATUS_BADGE_CLASS[status] || 'badge-pending';
    return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
}

function roleBadge(role) {
    const cls = `badge-role-${(role || '').toLowerCase()}`;
    return `<span class="badge ${cls}">${escapeHtml(role)}</span>`;
}

function actionLabel(action) {
    return ACTION_LABELS[action] || action;
}

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value === null || value === undefined ? '' : String(value);
    return div.innerHTML;
}

async function logout() {
    try {
        await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch (err) {
        /* ignore - redirect regardless */
    }
    window.location.href = '/login';
}
