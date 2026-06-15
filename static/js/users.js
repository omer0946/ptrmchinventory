const ROLE = window.CURRENT_USER.role;
const CAN_MANAGE_USERS = ROLE === 'Admin' || ROLE === 'Manager';

let allUsers = [];

document.addEventListener('DOMContentLoaded', () => {
    if (!CAN_MANAGE_USERS) {
        document.querySelector('main').innerHTML = `
            <div class="card p-6">
                <p class="text-sm text-slate-400">You do not have permission to access this page.</p>
            </div>`;
        return;
    }

    loadUsers();

    document.getElementById('add-user-btn').addEventListener('click', () => openUserModal(null));
    document.querySelectorAll('.modal-close').forEach((btn) => {
        btn.addEventListener('click', () => closeModal(btn.dataset.modal));
    });
    document.getElementById('user-form').addEventListener('submit', submitUserForm);
});

async function loadUsers() {
    try {
        allUsers = await apiRequest('/api/users');
        renderUsersTable();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function renderUsersTable() {
    const tbody = document.getElementById('users-table-body');

    if (!allUsers.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-slate-500">No users found.</td></tr>';
        return;
    }

    tbody.innerHTML = allUsers.map((user) => {
        const isSelf = user.id === window.CURRENT_USER.id;
        const handoutCell = user.material_handout_permission
            ? '<span class="badge badge-ok">Yes</span>'
            : '<span class="text-slate-500 text-xs">No</span>';

        const actions = [];
        if (user.status === 'Pending Approval') {
            actions.push(`
                <button class="btn-icon approve-user-btn" data-id="${user.id}" title="Approve">
                    <svg class="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                </button>`);
            actions.push(`
                <button class="btn-icon reject-user-btn" data-id="${user.id}" title="Reject">
                    <svg class="w-4 h-4 text-red-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>`);
        }
        actions.push(`
            <button class="btn-icon edit-user-btn" data-id="${user.id}" title="Edit User">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>
            </button>`);
        if (!isSelf && ROLE === 'Admin') {
            actions.push(`
                <button class="btn-icon danger delete-user-btn" data-id="${user.id}" title="Delete User">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                </button>`);
        }

        return `
            <tr>
                <td class="font-medium text-white">${escapeHtml(user.username)}${isSelf ? ' <span class="text-xs text-slate-500">(you)</span>' : ''}</td>
                <td>${escapeHtml(user.full_name)}</td>
                <td>${roleBadge(user.role)}</td>
                <td>${statusBadge(user.status)}</td>
                <td>${handoutCell}</td>
                <td class="text-slate-400 whitespace-nowrap">${formatDateTime(user.created_at)}</td>
                <td class="text-right whitespace-nowrap">
                    <div class="flex justify-end gap-1.5">${actions.join('')}</div>
                </td>
            </tr>
        `;
    }).join('');

    document.querySelectorAll('.edit-user-btn').forEach((btn) => {
        btn.addEventListener('click', () => openUserModal(Number(btn.dataset.id)));
    });
    document.querySelectorAll('.delete-user-btn').forEach((btn) => {
        btn.addEventListener('click', () => deleteUser(Number(btn.dataset.id)));
    });
    document.querySelectorAll('.approve-user-btn').forEach((btn) => {
        btn.addEventListener('click', () => setUserStatus(Number(btn.dataset.id), 'Approved'));
    });
    document.querySelectorAll('.reject-user-btn').forEach((btn) => {
        btn.addEventListener('click', () => setUserStatus(Number(btn.dataset.id), 'Rejected'));
    });
}

async function setUserStatus(userId, status) {
    try {
        await apiRequest(`/api/users/${userId}`, { method: 'PUT', body: { status } });
        showToast(`User ${status.toLowerCase()}`, 'success');
        loadUsers();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function openUserModal(userId) {
    const form = document.getElementById('user-form');
    form.reset();
    document.getElementById('user-form-error').classList.add('hidden');

    const user = userId ? allUsers.find((u) => u.id === userId) : null;
    const isSelf = user && user.id === window.CURRENT_USER.id;

    document.getElementById('user-id').value = user ? user.id : '';
    document.getElementById('user-modal-title').textContent = user ? 'Edit User' : 'Add User';

    const usernameInput = document.getElementById('user-username');
    usernameInput.value = user ? user.username : '';
    usernameInput.disabled = !!user;

    document.getElementById('user-fullname').value = user ? user.full_name : '';

    const roleSelect = document.getElementById('user-role');
    roleSelect.value = user ? user.role : 'Viewer';
    roleSelect.disabled = !!isSelf;

    const approvalSection = document.getElementById('user-approval-section');
    if (user) {
        approvalSection.classList.remove('hidden');
        document.getElementById('user-status').value = user.status;
        document.getElementById('user-handout-permission').checked = !!user.material_handout_permission;
    } else {
        approvalSection.classList.add('hidden');
    }

    const passwordInput = document.getElementById('user-password');
    const passwordHint = document.getElementById('password-hint');
    const passwordHelp = document.getElementById('password-help');

    if (user) {
        passwordInput.required = false;
        passwordHint.textContent = '';
        passwordHelp.classList.remove('hidden');
    } else {
        passwordInput.required = true;
        passwordHint.textContent = '*';
        passwordHelp.classList.add('hidden');
    }

    openModal('user-modal');
}

async function submitUserForm(event) {
    event.preventDefault();
    const errorBox = document.getElementById('user-form-error');
    errorBox.classList.add('hidden');

    const userId = document.getElementById('user-id').value;
    const password = document.getElementById('user-password').value;

    const payload = {
        full_name: document.getElementById('user-fullname').value.trim(),
        role: document.getElementById('user-role').value,
    };

    if (userId) {
        payload.status = document.getElementById('user-status').value;
        payload.material_handout_permission = document.getElementById('user-handout-permission').checked;
    }

    if (password) payload.password = password;
    if (!userId) payload.username = document.getElementById('user-username').value.trim();

    try {
        if (userId) {
            await apiRequest(`/api/users/${userId}`, { method: 'PUT', body: payload });
            showToast('User updated successfully', 'success');
        } else {
            await apiRequest('/api/users', { method: 'POST', body: payload });
            showToast('User created successfully (pending approval)', 'success');
        }
        closeModal('user-modal');
        loadUsers();
    } catch (err) {
        errorBox.textContent = err.message;
        errorBox.classList.remove('hidden');
    }
}

async function deleteUser(userId) {
    const user = allUsers.find((u) => u.id === userId);
    if (!user) return;
    if (!confirm(`Delete user "${user.username}"? This cannot be undone.`)) return;

    try {
        await apiRequest(`/api/users/${userId}`, { method: 'DELETE' });
        showToast('User deleted', 'success');
        loadUsers();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}
