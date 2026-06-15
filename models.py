from datetime import datetime

from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash

from extensions import db


# --- Roles (4-level RBAC) --------------------------------------------------
ROLE_ADMIN = 'Admin'
ROLE_MANAGER = 'Manager'
ROLE_STOREKEEPER = 'Storekeeper'
ROLE_VIEWER = 'Viewer'
VALID_ROLES = (ROLE_ADMIN, ROLE_MANAGER, ROLE_STOREKEEPER, ROLE_VIEWER)

# --- User approval workflow ------------------------------------------------
USER_STATUS_PENDING = 'Pending Approval'
USER_STATUS_APPROVED = 'Approved'
USER_STATUS_REJECTED = 'Rejected'
VALID_USER_STATUSES = (USER_STATUS_PENDING, USER_STATUS_APPROVED, USER_STATUS_REJECTED)

# --- Item types --------------------------------------------------------------
ITEM_TYPE_CONSUMABLE = 'Consumable'
ITEM_TYPE_FIXED_ASSET = 'Fixed Asset'
VALID_ITEM_TYPES = (ITEM_TYPE_CONSUMABLE, ITEM_TYPE_FIXED_ASSET)

REQUEST_PENDING = 'Pending'
REQUEST_APPROVED = 'Approved'
REQUEST_REJECTED = 'Rejected'

# --- Material Request line-item delivery status -----------------------------
LINE_STATUS_PENDING = 'Pending'
LINE_STATUS_PARTIAL = 'Partially Received'
LINE_STATUS_FULL = 'Fully Received'
VALID_LINE_STATUSES = (LINE_STATUS_PENDING, LINE_STATUS_PARTIAL, LINE_STATUS_FULL)

# --- Reasons recorded on CHECK_OUT / stock-reduction entries -----------------
REASON_CONSUMED = 'Consumed'
REASON_DAMAGED = 'Damaged'
REASON_SCRAP = 'Scrap'
REASON_LOST = 'Lost'
VALID_REASONS = (REASON_CONSUMED, REASON_DAMAGED, REASON_SCRAP, REASON_LOST)
LOSS_REASONS = (REASON_DAMAGED, REASON_SCRAP, REASON_LOST)

# --- Asset assignment return conditions (Zimmet) -----------------------------
RETURN_RETURNED = 'Returned'
RETURN_DAMAGED = 'Damaged'
RETURN_LOST = 'Lost'
VALID_RETURN_CONDITIONS = (RETURN_RETURNED, RETURN_DAMAGED, RETURN_LOST)


class User(db.Model, UserMixin):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False, index=True)
    full_name = db.Column(db.String(100), nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False, default=ROLE_VIEWER)
    status = db.Column(db.String(30), nullable=False, default=USER_STATUS_PENDING)
    material_handout_permission = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    @property
    def can_receive_handout(self):
        """Storekeepers may only hand out / assign assets to users meeting both conditions."""
        return self.status == USER_STATUS_APPROVED and self.material_handout_permission

    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'full_name': self.full_name,
            'role': self.role,
            'status': self.status,
            'material_handout_permission': self.material_handout_permission,
            'can_receive_handout': self.can_receive_handout,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class Location(db.Model):
    __tablename__ = 'locations'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), unique=True, nullable=False)
    description = db.Column(db.String(255), default='')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    stock_levels = db.relationship(
        'StockLevel', backref='location', cascade='all, delete-orphan', lazy='dynamic'
    )

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description or '',
        }


class Item(db.Model):
    __tablename__ = 'items'

    id = db.Column(db.Integer, primary_key=True)
    item_code = db.Column(db.String(50), unique=True, nullable=False)
    name = db.Column(db.String(150), nullable=False)
    category = db.Column(db.String(50), nullable=False)
    unit = db.Column(db.String(20), nullable=False)
    item_type = db.Column(db.String(20), nullable=False, default=ITEM_TYPE_CONSUMABLE)
    unit_conversion_note = db.Column(db.String(255), default='')
    min_stock_level = db.Column(db.Float, default=0, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    stock_levels = db.relationship(
        'StockLevel', backref='item', cascade='all, delete-orphan', lazy='dynamic'
    )
    attachments = db.relationship(
        'ItemAttachment', backref='item', cascade='all, delete-orphan', lazy='dynamic'
    )

    @property
    def total_quantity(self):
        return sum(sl.quantity for sl in self.stock_levels)

    def to_dict(self, locations=None):
        stock_by_location = {sl.location_id: sl for sl in self.stock_levels}
        location_data = []
        if locations:
            for loc in locations:
                sl = stock_by_location.get(loc.id)
                qty = sl.quantity if sl else 0
                min_level = sl.min_stock_level if sl else 0
                location_data.append({
                    'location_id': loc.id,
                    'location_name': loc.name,
                    'quantity': qty,
                    'min_stock_level': min_level,
                    'is_low_stock': min_level > 0 and qty < min_level,
                })

        total = sum(sl.quantity for sl in stock_by_location.values())
        return {
            'id': self.id,
            'item_code': self.item_code,
            'name': self.name,
            'category': self.category,
            'unit': self.unit,
            'item_type': self.item_type,
            'unit_conversion_note': self.unit_conversion_note or '',
            'min_stock_level': self.min_stock_level,
            'total_quantity': total,
            'is_low_stock': self.min_stock_level > 0 and total < self.min_stock_level,
            'locations': location_data,
        }


def generate_item_code():
    """Return the next unused sequential item code, e.g. ITM-0001."""
    n = Item.query.count() + 1
    while True:
        code = f'ITM-{n:04d}'
        if not Item.query.filter_by(item_code=code).first():
            return code
        n += 1


class StockLevel(db.Model):
    __tablename__ = 'stock_levels'

    id = db.Column(db.Integer, primary_key=True)
    item_id = db.Column(db.Integer, db.ForeignKey('items.id'), nullable=False)
    location_id = db.Column(db.Integer, db.ForeignKey('locations.id'), nullable=False)
    quantity = db.Column(db.Float, default=0, nullable=False)
    min_stock_level = db.Column(db.Float, default=0, nullable=False)

    __table_args__ = (
        db.UniqueConstraint('item_id', 'location_id', name='uq_stock_item_location'),
    )


class ItemAttachment(db.Model):
    """Generic multi-file attachment (datasheets, certificates, photos, manuals, etc.)."""
    __tablename__ = 'item_attachments'

    id = db.Column(db.Integer, primary_key=True)
    item_id = db.Column(db.Integer, db.ForeignKey('items.id'), nullable=False)
    file_path = db.Column(db.String(255), nullable=False)
    original_filename = db.Column(db.String(255), nullable=False)
    uploaded_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    uploaded_at = db.Column(db.DateTime, default=datetime.utcnow)

    uploaded_by = db.relationship('User', foreign_keys=[uploaded_by_id])

    def to_dict(self):
        return {
            'id': self.id,
            'item_id': self.item_id,
            'file_path': self.file_path,
            'original_filename': self.original_filename,
            'uploaded_by': self.uploaded_by.full_name if self.uploaded_by else 'System',
            'uploaded_at': self.uploaded_at.isoformat() if self.uploaded_at else None,
        }


class InventoryLog(db.Model):
    __tablename__ = 'inventory_logs'

    id = db.Column(db.Integer, primary_key=True)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    action = db.Column(db.String(50), nullable=False)
    item_id = db.Column(db.Integer, db.ForeignKey('items.id'), nullable=True)
    location_id = db.Column(db.Integer, db.ForeignKey('locations.id'), nullable=True)
    target_location_id = db.Column(db.Integer, db.ForeignKey('locations.id'), nullable=True)
    quantity = db.Column(db.Float, nullable=True)
    notes = db.Column(db.String(500), default='')
    heat_number = db.Column(db.String(100), nullable=True)
    batch_number = db.Column(db.String(100), nullable=True)
    mtr_file = db.Column(db.String(255), nullable=True)
    reason = db.Column(db.String(20), nullable=True)

    user = db.relationship('User', foreign_keys=[user_id])
    item = db.relationship('Item', foreign_keys=[item_id])
    location = db.relationship('Location', foreign_keys=[location_id])
    target_location = db.relationship('Location', foreign_keys=[target_location_id])

    def to_dict(self):
        return {
            'id': self.id,
            'timestamp': self.timestamp.isoformat() if self.timestamp else None,
            'user': self.user.full_name if self.user else 'System',
            'action': self.action,
            'item': self.item.name if self.item else None,
            'item_code': self.item.item_code if self.item else None,
            'location': self.location.name if self.location else None,
            'target_location': self.target_location.name if self.target_location else None,
            'quantity': self.quantity,
            'notes': self.notes or '',
            'heat_number': self.heat_number or '',
            'batch_number': self.batch_number or '',
            'mtr_file': self.mtr_file,
            'reason': self.reason or '',
        }


class AssetAssignment(db.Model):
    """Zimmet: tracks a Fixed Asset on loan to an approved user."""
    __tablename__ = 'asset_assignments'

    id = db.Column(db.Integer, primary_key=True)
    item_id = db.Column(db.Integer, db.ForeignKey('items.id'), nullable=False)
    location_id = db.Column(db.Integer, db.ForeignKey('locations.id'), nullable=False)
    quantity = db.Column(db.Float, nullable=False, default=1)
    assigned_to_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    assigned_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    assigned_at = db.Column(db.DateTime, default=datetime.utcnow)
    notes = db.Column(db.String(500), default='')
    returned_at = db.Column(db.DateTime, nullable=True)
    return_condition = db.Column(db.String(20), nullable=True)
    return_notes = db.Column(db.String(500), default='')
    checkout_log_id = db.Column(db.Integer, db.ForeignKey('inventory_logs.id'), nullable=True)
    return_log_id = db.Column(db.Integer, db.ForeignKey('inventory_logs.id'), nullable=True)

    item = db.relationship('Item', foreign_keys=[item_id])
    location = db.relationship('Location', foreign_keys=[location_id])
    assigned_to = db.relationship('User', foreign_keys=[assigned_to_id])
    assigned_by = db.relationship('User', foreign_keys=[assigned_by_id])

    @property
    def is_returned(self):
        return self.returned_at is not None

    def to_dict(self):
        return {
            'id': self.id,
            'item_id': self.item_id,
            'item_name': self.item.name if self.item else None,
            'item_code': self.item.item_code if self.item else None,
            'unit': self.item.unit if self.item else None,
            'location_id': self.location_id,
            'location_name': self.location.name if self.location else None,
            'quantity': self.quantity,
            'assigned_to_id': self.assigned_to_id,
            'assigned_to': self.assigned_to.full_name if self.assigned_to else None,
            'assigned_by': self.assigned_by.full_name if self.assigned_by else None,
            'assigned_at': self.assigned_at.isoformat() if self.assigned_at else None,
            'notes': self.notes or '',
            'returned_at': self.returned_at.isoformat() if self.returned_at else None,
            'return_condition': self.return_condition,
            'return_notes': self.return_notes or '',
            'is_returned': self.is_returned,
            'checkout_log_id': self.checkout_log_id,
            'return_log_id': self.return_log_id,
        }


class MaterialRequest(db.Model):
    __tablename__ = 'material_requests'

    id = db.Column(db.Integer, primary_key=True)
    requester_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    target_location_id = db.Column(db.Integer, db.ForeignKey('locations.id'), nullable=False)
    status = db.Column(db.String(20), default=REQUEST_PENDING, nullable=False)
    notes = db.Column(db.String(500), default='')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    reviewed_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)

    requester = db.relationship('User', foreign_keys=[requester_id])
    reviewer = db.relationship('User', foreign_keys=[reviewed_by_id])
    target_location = db.relationship('Location', foreign_keys=[target_location_id])
    lines = db.relationship('MaterialRequestLine', backref='request', cascade='all, delete-orphan')

    @property
    def delivery_status(self):
        """Aggregate delivery status across all lines."""
        if not self.lines:
            return LINE_STATUS_PENDING
        statuses = {line.line_status for line in self.lines}
        if statuses == {LINE_STATUS_FULL}:
            return LINE_STATUS_FULL
        if statuses == {LINE_STATUS_PENDING}:
            return LINE_STATUS_PENDING
        return LINE_STATUS_PARTIAL

    def to_dict(self):
        return {
            'id': self.id,
            'requester': self.requester.full_name if self.requester else None,
            'requester_id': self.requester_id,
            'target_location_id': self.target_location_id,
            'target_location': self.target_location.name if self.target_location else None,
            'status': self.status,
            'delivery_status': self.delivery_status,
            'notes': self.notes or '',
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'reviewed_by': self.reviewer.full_name if self.reviewer else None,
            'lines': [line.to_dict() for line in self.lines],
        }


class MaterialRequestLine(db.Model):
    __tablename__ = 'material_request_lines'

    id = db.Column(db.Integer, primary_key=True)
    request_id = db.Column(db.Integer, db.ForeignKey('material_requests.id'), nullable=False)
    item_id = db.Column(db.Integer, db.ForeignKey('items.id'), nullable=True)
    new_item_name = db.Column(db.String(150), nullable=True)
    new_item_category = db.Column(db.String(50), nullable=True)
    new_item_unit = db.Column(db.String(20), nullable=True)
    requested_quantity = db.Column(db.Float, nullable=False)
    received_quantity = db.Column(db.Float, nullable=False, default=0)
    line_status = db.Column(db.String(30), nullable=False, default=LINE_STATUS_PENDING)

    item = db.relationship('Item', foreign_keys=[item_id])

    def refresh_status(self):
        """Recompute line_status from received_quantity vs requested_quantity."""
        if self.received_quantity <= 0:
            self.line_status = LINE_STATUS_PENDING
        elif self.received_quantity < self.requested_quantity:
            self.line_status = LINE_STATUS_PARTIAL
        else:
            self.line_status = LINE_STATUS_FULL

    def to_dict(self):
        if self.item_id and self.item:
            return {
                'id': self.id,
                'item_id': self.item_id,
                'material_name': self.item.name,
                'item_code': self.item.item_code,
                'category': self.item.category,
                'unit': self.item.unit,
                'current_stock': self.item.total_quantity,
                'min_stock_level': self.item.min_stock_level,
                'is_new_item': False,
                'requested_quantity': self.requested_quantity,
                'received_quantity': self.received_quantity,
                'line_status': self.line_status,
            }
        return {
            'id': self.id,
            'item_id': None,
            'material_name': self.new_item_name,
            'item_code': None,
            'category': self.new_item_category,
            'unit': self.new_item_unit,
            'current_stock': None,
            'min_stock_level': None,
            'is_new_item': True,
            'requested_quantity': self.requested_quantity,
            'received_quantity': self.received_quantity,
            'line_status': self.line_status,
        }
