# Warehouse Stock & Inventory Tracking Module

A production-ready, web-based inventory management system for a mechanical
construction site. It supports multi-location stock tracking, atomic stock
transfers, a Material Request Form (MRF) approval workflow, role-based
access control, and a full audit log.

## Tech Stack

- **Backend:** Python 3 + Flask, Flask-SQLAlchemy, Flask-Login
- **Database:** SQLite (file-based, auto-created on first run)
- **Frontend:** HTML5, Tailwind CSS (via CDN), Vanilla JavaScript
- **Auth:** Session-based authentication with role-based access control (RBAC)

## Project Structure

```
.
├── app.py                 # Application entrypoint (Flask app factory)
├── config.py              # Configuration (secret key, database URI)
├── extensions.py          # Shared SQLAlchemy / LoginManager instances
├── models.py               # SQLAlchemy ORM models
├── seed.py                 # Initial demo data (users, locations, items)
├── requirements.txt
├── routes/
│   ├── auth.py              # Login / logout / session endpoints
│   ├── pages.py             # Server-rendered page routes
│   ├── decorators.py        # RBAC decorator (roles_required)
│   ├── api_items.py         # Inventory CRUD + check-in / check-out
│   ├── api_locations.py     # Location CRUD
│   ├── api_transfers.py     # Atomic material transfers
│   ├── api_requests.py      # Material Request Form (MRF) workflow
│   ├── api_logs.py           # Inventory audit log
│   ├── api_users.py          # User management (admin)
│   └── api_dashboard.py      # Dashboard summary data
├── templates/               # Jinja2 HTML templates (dark UI)
└── static/
    ├── css/style.css         # Custom dark theme styles
    └── js/                    # Page-specific vanilla JS
```

## Setup & Installation

1. **Create a virtual environment** (recommended):

   ```bash
   python -m venv venv
   ```

   Activate it:

   - Windows: `venv\Scripts\activate`
   - macOS / Linux: `source venv/bin/activate`

2. **Install dependencies:**

   ```bash
   pip install -r requirements.txt
   ```

3. **Run the application:**

   ```bash
   python app.py
   ```

   The app starts at **http://127.0.0.1:5000**.

   On first run, the SQLite database is automatically created at
   `instance/inventory.db` and pre-populated with demo data: 3 locations
   (Central Warehouse, Site Depot, Zone X), a catalog of construction
   materials, and 3 demo user accounts (see below).

## Demo Accounts (Role-Based Access Control)

| Role       | Username | Password   | Permissions                                                                 |
|------------|----------|------------|------------------------------------------------------------------------------|
| **Admin**  | `admin`  | `admin123` | Full control: manage items, locations, users; approve/reject requests; edit any request; view logs |
| **Editor** | `editor` | `editor123`| Check-in / check-out stock, transfer stock between locations, create & submit material requests |
| **Viewer** | `viewer` | `viewer123`| Read-only access to stock balances, locations, and request statuses          |

The login page also has one-click buttons to fill these credentials.

## Core Features

### 1. Multi-Location Architecture
- Pre-seeded with **Central Warehouse**, **Site Depot**, and **Zone X**.
- Admins can add, edit, and delete locations from the **Locations** page.
- The Inventory table shows per-location stock breakdown plus a cumulative total per item.
- **Material Transfer** page atomically moves stock from one location to another (single DB transaction — both balances update together or not at all).

### 2. Material Request Form (MRF) & Approval Workflow
- Editors (and Admins) submit requests specifying target location, one or more items, and quantities.
- Admins review pending requests on the **Material Requests** page and mark them **Approved** or **Rejected**.
- Admins can edit any request; Editors can edit their own **Pending** requests.
- Viewers have read-only access to request statuses.

### 3. Role-Based Access Control
- **Admin:** full system control — manage items, locations, users, and approve/reject requests.
- **Editor:** process check-ins, check-outs, transfers, and submit requests. Cannot delete items, locations, or users.
- **Viewer:** read-only access to stock balances, locations, and request statuses.

All permissions are enforced both in the UI (hiding controls) and in the API (`roles_required` decorator on every mutating endpoint).

### 4. Inventory Management & Audit Trail
- Each item has a Name, Category (Pipe, Flange, Valve, Bolt, etc.), Unit (Meter, Pcs, Ton, Set, etc.), per-location quantities, and a computed total.
- Set a **Minimum Stock Level** per item — the Inventory and Dashboard pages display a red "Critical" badge and alert banner when total stock falls below this threshold.
- Every check-in, check-out, transfer, item change, and request status change is recorded in the **Inventory Log** with timestamp, user, action, item, location(s), quantity, and notes.

## API Overview

All API endpoints are prefixed with `/api/` and require an authenticated session (cookie-based). Key endpoints:

| Endpoint                                 | Methods         | Roles                |
|-------------------------------------------|------------------|----------------------|
| `/api/auth/login`, `/api/auth/logout`      | POST             | Public / Authenticated |
| `/api/items`                               | GET, POST        | All / Admin           |
| `/api/items/<id>`                          | PUT, DELETE      | Admin                  |
| `/api/items/<id>/check-in`                 | POST             | Admin, Editor          |
| `/api/items/<id>/check-out`                | POST             | Admin, Editor          |
| `/api/locations`                           | GET, POST        | All / Admin            |
| `/api/locations/<id>`                      | PUT, DELETE      | Admin                  |
| `/api/transfers`                           | POST             | Admin, Editor          |
| `/api/requests`                            | GET, POST        | All / Admin, Editor    |
| `/api/requests/<id>`                       | PUT              | Admin (any), Editor (own pending) |
| `/api/requests/<id>/approve`               | POST             | Admin                  |
| `/api/requests/<id>/reject`                | POST             | Admin                  |
| `/api/logs`                                | GET              | Admin, Editor          |
| `/api/users`                               | GET, POST        | Admin                  |
| `/api/users/<id>`                          | PUT, DELETE      | Admin                  |
| `/api/dashboard/summary`                   | GET              | All                    |

## Resetting the Database

To reset all data back to the seeded demo state, stop the app and delete the
database file, then restart:

```bash
rm instance/inventory.db   # Windows: del instance\inventory.db
python app.py
```
