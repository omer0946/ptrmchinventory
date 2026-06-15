import os
import uuid

from flask import Blueprint, request, jsonify, current_app
from flask_login import login_required, current_user
from werkzeug.utils import secure_filename

from extensions import db
from models import (
    Item, Location, StockLevel, InventoryLog, MaterialRequestLine, ItemAttachment, AssetAssignment,
    generate_item_code, VALID_REASONS, REASON_CONSUMED, VALID_ITEM_TYPES, ITEM_TYPE_CONSUMABLE, ITEM_TYPE_FIXED_ASSET,
    ROLE_ADMIN, ROLE_STOREKEEPER,
)
from routes.decorators import roles_required

items_api = Blueprint('items_api', __name__)

ALLOWED_MTR_EXTENSIONS = {'pdf'}
ALLOWED_ATTACHMENT_EXTENSIONS = {'pdf', 'png', 'jpg', 'jpeg', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'dwg'}


def _all_locations():
    return Location.query.order_by(Location.id).all()


def _parse_quantity(value):
    try:
        quantity = float(value)
    except (TypeError, ValueError):
        return None
    return quantity


def _request_data():
    """Return request payload as a dict-like, supporting both JSON and form submissions."""
    if request.is_json:
        return request.get_json(silent=True) or {}
    return request.form


def _save_mtr_file(file_storage):
    """Save an uploaded MTR/certificate PDF to static/uploads/ and return its relative path."""
    if not file_storage or not file_storage.filename:
        return None, None

    filename = secure_filename(file_storage.filename)
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    if ext not in ALLOWED_MTR_EXTENSIONS:
        return None, 'MTR certificate must be a PDF file'

    upload_dir = os.path.join(current_app.root_path, 'static', 'uploads')
    os.makedirs(upload_dir, exist_ok=True)

    unique_name = f'{uuid.uuid4().hex}_{filename}'
    file_storage.save(os.path.join(upload_dir, unique_name))
    return f'uploads/{unique_name}', None


def _save_attachment_file(file_storage):
    """Save a generic item attachment (datasheet, certificate, photo, manual, ...)."""
    if not file_storage or not file_storage.filename:
        return None, None, None

    filename = secure_filename(file_storage.filename)
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    if ext not in ALLOWED_ATTACHMENT_EXTENSIONS:
        return None, None, f'File type ".{ext}" is not allowed'

    upload_dir = os.path.join(current_app.root_path, 'static', 'uploads')
    os.makedirs(upload_dir, exist_ok=True)

    unique_name = f'{uuid.uuid4().hex}_{filename}'
    file_storage.save(os.path.join(upload_dir, unique_name))
    return f'uploads/{unique_name}', filename, None


@items_api.route('', methods=['GET'])
@login_required
def list_items():
    locations = _all_locations()
    items = Item.query.order_by(Item.name).all()
    return jsonify({
        'items': [item.to_dict(locations) for item in items],
        'locations': [loc.to_dict() for loc in locations],
    })


@items_api.route('', methods=['POST'])
@roles_required(ROLE_ADMIN)
def create_item():
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    category = (data.get('category') or '').strip()
    unit = (data.get('unit') or '').strip()

    if not name or not category or not unit:
        return jsonify({'error': 'Name, category and unit are required'}), 400

    min_stock_level = _parse_quantity(data.get('min_stock_level') or 0)
    if min_stock_level is None or min_stock_level < 0:
        return jsonify({'error': 'Minimum stock level must be a non-negative number'}), 400

    item_type = (data.get('item_type') or ITEM_TYPE_CONSUMABLE).strip()
    if item_type not in VALID_ITEM_TYPES:
        return jsonify({'error': f'item_type must be one of: {", ".join(VALID_ITEM_TYPES)}'}), 400

    unit_conversion_note = (data.get('unit_conversion_note') or '').strip()

    item_code = (data.get('item_code') or '').strip()
    if item_code:
        if Item.query.filter(db.func.lower(Item.item_code) == item_code.lower()).first():
            return jsonify({'error': 'An item with this code already exists'}), 400
    else:
        item_code = generate_item_code()

    item = Item(
        item_code=item_code, name=name, category=category, unit=unit,
        item_type=item_type, unit_conversion_note=unit_conversion_note,
        min_stock_level=min_stock_level,
    )
    db.session.add(item)
    db.session.flush()

    initial_stock = data.get('initial_stock') or {}
    initial_min_stock = data.get('initial_min_stock') or {}
    for loc in _all_locations():
        raw_qty = initial_stock.get(str(loc.id), 0)
        qty = _parse_quantity(raw_qty) if raw_qty not in (None, '') else 0
        if qty is None or qty < 0:
            qty = 0

        raw_min = initial_min_stock.get(str(loc.id), 0)
        loc_min = _parse_quantity(raw_min) if raw_min not in (None, '') else 0
        if loc_min is None or loc_min < 0:
            loc_min = 0

        db.session.add(StockLevel(item_id=item.id, location_id=loc.id, quantity=qty, min_stock_level=loc_min))
        if qty > 0:
            db.session.add(InventoryLog(
                user_id=current_user.id,
                action='CHECK_IN',
                item_id=item.id,
                location_id=loc.id,
                quantity=qty,
                notes='Initial stock recorded on item creation',
            ))

    db.session.add(InventoryLog(
        user_id=current_user.id,
        action='ITEM_CREATED',
        item_id=item.id,
        notes=f'Item "{item.name}" created',
    ))
    db.session.commit()
    return jsonify(item.to_dict(_all_locations())), 201


@items_api.route('/<int:item_id>', methods=['PUT'])
@roles_required(ROLE_ADMIN)
def update_item(item_id):
    item = Item.query.get_or_404(item_id)
    data = request.get_json(silent=True) or {}

    if 'item_type' in data:
        item_type = (data.get('item_type') or '').strip()
        if item_type not in VALID_ITEM_TYPES:
            return jsonify({'error': f'item_type must be one of: {", ".join(VALID_ITEM_TYPES)}'}), 400
        item.item_type = item_type

    if 'unit_conversion_note' in data:
        item.unit_conversion_note = (data.get('unit_conversion_note') or '').strip()

    if 'item_code' in data:
        item_code = (data.get('item_code') or '').strip()
        if not item_code:
            return jsonify({'error': 'Item code cannot be empty'}), 400
        existing = Item.query.filter(db.func.lower(Item.item_code) == item_code.lower()).first()
        if existing and existing.id != item.id:
            return jsonify({'error': 'An item with this code already exists'}), 400
        item.item_code = item_code

    if 'name' in data and (data.get('name') or '').strip():
        item.name = data['name'].strip()
    if 'category' in data and (data.get('category') or '').strip():
        item.category = data['category'].strip()
    if 'unit' in data and (data.get('unit') or '').strip():
        item.unit = data['unit'].strip()
    if 'min_stock_level' in data:
        min_stock_level = _parse_quantity(data.get('min_stock_level') or 0)
        if min_stock_level is None or min_stock_level < 0:
            return jsonify({'error': 'Minimum stock level must be a non-negative number'}), 400
        item.min_stock_level = min_stock_level

    if 'location_min_stock' in data:
        location_min_stock = data.get('location_min_stock') or {}
        for loc in _all_locations():
            raw_min = location_min_stock.get(str(loc.id))
            if raw_min is None:
                continue
            loc_min = _parse_quantity(raw_min) if raw_min != '' else 0
            if loc_min is None or loc_min < 0:
                return jsonify({'error': 'Minimum stock level must be a non-negative number'}), 400

            stock = StockLevel.query.filter_by(item_id=item.id, location_id=loc.id).first()
            if stock is None:
                stock = StockLevel(item_id=item.id, location_id=loc.id, quantity=0)
                db.session.add(stock)
            stock.min_stock_level = loc_min

    db.session.add(InventoryLog(
        user_id=current_user.id,
        action='ITEM_UPDATED',
        item_id=item.id,
        notes=f'Item "{item.name}" details updated',
    ))
    db.session.commit()
    return jsonify(item.to_dict(_all_locations()))


@items_api.route('/<int:item_id>', methods=['DELETE'])
@roles_required(ROLE_ADMIN)
def delete_item(item_id):
    item = Item.query.get_or_404(item_id)

    if MaterialRequestLine.query.filter_by(item_id=item.id).first():
        return jsonify({'error': 'Cannot delete an item that is referenced in material requests'}), 400

    if AssetAssignment.query.filter_by(item_id=item.id).first():
        return jsonify({'error': 'Cannot delete an item that has asset assignment (Zimmet) history'}), 400

    name = item.name
    InventoryLog.query.filter_by(item_id=item.id).update({'item_id': None})
    db.session.delete(item)
    db.session.add(InventoryLog(
        user_id=current_user.id,
        action='ITEM_DELETED',
        item_id=None,
        notes=f'Item "{name}" deleted',
    ))
    db.session.commit()
    return jsonify({'message': 'Item deleted'})


@items_api.route('/<int:item_id>/check-in', methods=['POST'])
@roles_required(ROLE_ADMIN, ROLE_STOREKEEPER)
def check_in(item_id):
    item = Item.query.get_or_404(item_id)
    data = _request_data()

    location_id = data.get('location_id')
    quantity = _parse_quantity(data.get('quantity'))

    if not location_id or quantity is None:
        return jsonify({'error': 'location_id and a numeric quantity are required'}), 400
    if quantity <= 0:
        return jsonify({'error': 'Quantity must be greater than zero'}), 400

    location = Location.query.get_or_404(location_id)

    stock = StockLevel.query.filter_by(item_id=item.id, location_id=location.id).first()
    if stock is None:
        stock = StockLevel(item_id=item.id, location_id=location.id, quantity=0)
        db.session.add(stock)

    stock.quantity += quantity

    mtr_file, mtr_error = _save_mtr_file(request.files.get('mtr_file'))
    if mtr_error:
        return jsonify({'error': mtr_error}), 400

    log = InventoryLog(
        user_id=current_user.id,
        action='CHECK_IN',
        item_id=item.id,
        location_id=location.id,
        quantity=quantity,
        notes=(data.get('notes') or '').strip(),
        heat_number=(data.get('heat_number') or '').strip() or None,
        batch_number=(data.get('batch_number') or '').strip() or None,
        mtr_file=mtr_file,
    )
    db.session.add(log)
    db.session.commit()
    return jsonify({'item': item.to_dict(_all_locations()), 'log_id': log.id})


@items_api.route('/<int:item_id>/check-out', methods=['POST'])
@roles_required(ROLE_ADMIN, ROLE_STOREKEEPER)
def check_out(item_id):
    item = Item.query.get_or_404(item_id)
    data = request.get_json(silent=True) or {}

    if item.item_type == ITEM_TYPE_FIXED_ASSET:
        return jsonify({'error': 'Fixed Assets must be checked out via Asset Assignment (Zimmet) to a registered user.'}), 400

    location_id = data.get('location_id')
    quantity = _parse_quantity(data.get('quantity'))

    if not location_id or quantity is None:
        return jsonify({'error': 'location_id and a numeric quantity are required'}), 400
    if quantity <= 0:
        return jsonify({'error': 'Quantity must be greater than zero'}), 400

    reason = (data.get('reason') or '').strip() or REASON_CONSUMED
    if reason not in VALID_REASONS:
        return jsonify({'error': f'reason must be one of: {", ".join(VALID_REASONS)}'}), 400

    location = Location.query.get_or_404(location_id)
    stock = StockLevel.query.filter_by(item_id=item.id, location_id=location.id).first()

    if stock is None or stock.quantity < quantity:
        return jsonify({'error': f'Insufficient stock of "{item.name}" at {location.name}'}), 400

    stock.quantity -= quantity

    log = InventoryLog(
        user_id=current_user.id,
        action='CHECK_OUT',
        item_id=item.id,
        location_id=location.id,
        quantity=quantity,
        notes=(data.get('notes') or '').strip(),
        heat_number=(data.get('heat_number') or '').strip() or None,
        batch_number=(data.get('batch_number') or '').strip() or None,
        reason=reason,
    )
    db.session.add(log)
    db.session.commit()
    return jsonify({'item': item.to_dict(_all_locations()), 'log_id': log.id})


@items_api.route('/<int:item_id>/profile', methods=['GET'])
@login_required
def item_profile(item_id):
    """Item Profile: location breakdown, attachments, and transaction history."""
    item = Item.query.get_or_404(item_id)
    logs = InventoryLog.query.filter_by(item_id=item.id).order_by(InventoryLog.timestamp.desc()).limit(100).all()
    assignments = AssetAssignment.query.filter_by(item_id=item.id).order_by(AssetAssignment.assigned_at.desc()).all()

    return jsonify({
        'item': item.to_dict(_all_locations()),
        'attachments': [a.to_dict() for a in item.attachments],
        'logs': [log.to_dict() for log in logs],
        'assignments': [a.to_dict() for a in assignments],
    })


@items_api.route('/<int:item_id>/attachments', methods=['POST'])
@roles_required(ROLE_ADMIN, ROLE_STOREKEEPER)
def upload_attachments(item_id):
    item = Item.query.get_or_404(item_id)
    files = request.files.getlist('files')
    if not files or all(not f.filename for f in files):
        return jsonify({'error': 'No files provided'}), 400

    created = []
    for file_storage in files:
        if not file_storage.filename:
            continue
        path, original_name, error = _save_attachment_file(file_storage)
        if error:
            return jsonify({'error': error}), 400
        attachment = ItemAttachment(
            item_id=item.id,
            file_path=path,
            original_filename=original_name,
            uploaded_by_id=current_user.id,
        )
        db.session.add(attachment)
        created.append(attachment)

    db.session.commit()
    return jsonify([a.to_dict() for a in created]), 201


@items_api.route('/<int:item_id>/attachments/<int:attachment_id>', methods=['DELETE'])
@roles_required(ROLE_ADMIN, ROLE_STOREKEEPER)
def delete_attachment(item_id, attachment_id):
    attachment = ItemAttachment.query.filter_by(id=attachment_id, item_id=item_id).first_or_404()

    file_path = os.path.join(current_app.root_path, 'static', attachment.file_path)
    db.session.delete(attachment)
    db.session.commit()

    if os.path.exists(file_path):
        try:
            os.remove(file_path)
        except OSError:
            pass

    return jsonify({'message': 'Attachment deleted'})
