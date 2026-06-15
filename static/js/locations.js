let allLocations = [];
let allItems = [];

const ROLE = window.CURRENT_USER.role;
const CAN_MANAGE_LOCATIONS = ROLE === 'Admin';

document.addEventListener('DOMContentLoaded', () => {
    loadLocations();

    const addBtn = document.getElementById('add-location-btn');
    if (addBtn) addBtn.addEventListener('click', () => openLocationModal(null));

    document.querySelectorAll('.modal-close').forEach((btn) => {
        btn.addEventListener('click', () => closeModal(btn.dataset.modal));
    });

    document.getElementById('location-form').addEventListener('submit', submitLocationForm);
});

async function loadLocations() {
    try {
        const [locations, itemsData] = await Promise.all([
            apiRequest('/api/locations'),
            apiRequest('/api/items'),
        ]);
        allLocations = locations;
        allItems = itemsData.items;
        renderLocations();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function renderLocations() {
    const grid = document.getElementById('locations-grid');

    if (!allLocations.length) {
        grid.innerHTML = '<p class="text-sm text-slate-500">No locations configured yet.</p>';
        return;
    }

    grid.innerHTML = allLocations.map((loc) => `
        <div class="card p-5 flex flex-col cursor-pointer hover:border-blue-500/40 transition-colors location-card" data-id="${loc.id}" title="Click to view stocked items">
            <div class="flex items-start justify-between gap-2">
                <div class="flex items-center gap-3">
                    <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-600/10 text-blue-400 flex-shrink-0">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" /></svg>
                    </div>
                    <h3 class="text-base font-semibold text-white">${escapeHtml(loc.name)}</h3>
                </div>
                ${CAN_MANAGE_LOCATIONS ? `
                <div class="flex gap-1.5">
                    <button class="btn-icon edit-location-btn" data-id="${loc.id}" title="Edit Location">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>
                    </button>
                    <button class="btn-icon danger delete-location-btn" data-id="${loc.id}" title="Delete Location">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                    </button>
                </div>` : ''}
            </div>
            <p class="text-sm text-slate-400 mt-3 flex-1">${escapeHtml(loc.description || 'No description provided.')}</p>
            <div class="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-slate-800">
                <div>
                    <p class="text-xs text-slate-500 uppercase tracking-wide">Stocked Items</p>
                    <p class="text-lg font-semibold text-white mt-0.5">${formatNumber(loc.item_count)}</p>
                </div>
                <div>
                    <p class="text-xs text-slate-500 uppercase tracking-wide">Total Quantity</p>
                    <p class="text-lg font-semibold text-white mt-0.5">${formatNumber(loc.total_quantity)}</p>
                </div>
            </div>
        </div>
    `).join('');

    document.querySelectorAll('.location-card').forEach((card) => {
        card.addEventListener('click', () => openLocationItemsModal(Number(card.dataset.id)));
    });

    if (CAN_MANAGE_LOCATIONS) {
        document.querySelectorAll('.edit-location-btn').forEach((btn) => {
            btn.addEventListener('click', (event) => {
                event.stopPropagation();
                openLocationModal(Number(btn.dataset.id));
            });
        });
        document.querySelectorAll('.delete-location-btn').forEach((btn) => {
            btn.addEventListener('click', (event) => {
                event.stopPropagation();
                deleteLocation(Number(btn.dataset.id));
            });
        });
    }
}

function openLocationItemsModal(locationId) {
    const loc = allLocations.find((l) => l.id === locationId);
    if (!loc) return;

    document.getElementById('location-items-modal-title').textContent = `Items at ${loc.name}`;

    const rows = allItems
        .map((item) => {
            const stock = item.locations.find((l) => l.location_id === locationId);
            return stock ? { item, stock } : null;
        })
        .filter((entry) => entry && (entry.stock.quantity > 0 || entry.stock.min_stock_level > 0))
        .sort((a, b) => a.item.name.localeCompare(b.item.name));

    const tbody = document.getElementById('location-items-body');
    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-slate-500">No materials recorded at this location.</td></tr>';
    } else {
        tbody.innerHTML = rows.map(({ item, stock }) => {
            const statusBadge = stock.is_low_stock
                ? '<span class="badge badge-low">Critical</span>'
                : '<span class="badge badge-ok">OK</span>';
            return `
                <tr class="${stock.is_low_stock ? 'bg-red-500/5' : ''}">
                    <td class="text-slate-400 whitespace-nowrap">${escapeHtml(item.item_code)}</td>
                    <td class="font-medium text-white">${escapeHtml(item.name)}</td>
                    <td class="text-slate-400">${escapeHtml(item.category)}</td>
                    <td>${formatNumber(stock.quantity)} ${escapeHtml(item.unit)}</td>
                    <td class="text-slate-400">${formatNumber(stock.min_stock_level)}</td>
                    <td>${statusBadge}</td>
                </tr>
            `;
        }).join('');
    }

    openModal('location-items-modal');
}

function openLocationModal(locationId) {
    const form = document.getElementById('location-form');
    form.reset();
    document.getElementById('location-form-error').classList.add('hidden');

    const loc = locationId ? allLocations.find((l) => l.id === locationId) : null;
    document.getElementById('location-id').value = loc ? loc.id : '';
    document.getElementById('location-modal-title').textContent = loc ? 'Edit Location' : 'Add Location';
    document.getElementById('location-name').value = loc ? loc.name : '';
    document.getElementById('location-description').value = loc ? loc.description : '';

    openModal('location-modal');
}

async function submitLocationForm(event) {
    event.preventDefault();
    const errorBox = document.getElementById('location-form-error');
    errorBox.classList.add('hidden');

    const locationId = document.getElementById('location-id').value;
    const payload = {
        name: document.getElementById('location-name').value.trim(),
        description: document.getElementById('location-description').value.trim(),
    };

    try {
        if (locationId) {
            await apiRequest(`/api/locations/${locationId}`, { method: 'PUT', body: payload });
            showToast('Location updated successfully', 'success');
        } else {
            await apiRequest('/api/locations', { method: 'POST', body: payload });
            showToast('Location created successfully', 'success');
        }
        closeModal('location-modal');
        loadLocations();
    } catch (err) {
        errorBox.textContent = err.message;
        errorBox.classList.remove('hidden');
    }
}

async function deleteLocation(locationId) {
    const loc = allLocations.find((l) => l.id === locationId);
    if (!loc) return;
    if (!confirm(`Delete "${loc.name}"? This is only possible if it holds no stock.`)) return;

    try {
        await apiRequest(`/api/locations/${locationId}`, { method: 'DELETE' });
        showToast('Location deleted', 'success');
        loadLocations();
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
