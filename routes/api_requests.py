from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user

from extensions import db
from models import (
    MaterialRequest, MaterialRequestLine, Item, Location, StockLevel, InventoryLog, generate_item_code,
    ROLE_ADMIN, ROLE_MANAGER, ROLE_STOREKEEPER,
    REQUEST_PENDING, REQUEST_APPROVED, REQUEST_REJECTED,
)
from routes.decorators import roles_required

requests_api = Blueprint('requests_api', __name__)


def _parse_quantity(value):
    try:
        quantity = float(value)
    except (TypeError, ValueError):
        return None
    return quantity


def _apply_lines(req, lines):
    """Replace all request lines with the given list of line specs.

    Each line must reference either an existing `item_id` (to request more
    of a material already in the catalog, e.g. because stock is low) or
    provide `new_item_name` / `new_item_category` / `new_item_unit` to
    request a material that does not exist in the catalog yet.
    """
    if not lines:
        return 'At least one item line is required'

    parsed = []
    for line in lines:
        quantity = _parse_quantity(line.get('quantity') or line.get('requested_quantity'))
        if quantity is None or quantity <= 0:
            return 'Each line requires a quantity greater than zero'

        item_id = line.get('item_id')
        if item_id:
            if Item.query.get(item_id) is None:
                return f'Item with id {item_id} does not exist'
            parsed.append({'item_id': item_id, 'requested_quantity': quantity})
            continue

        new_name = (line.get('new_item_name') or '').strip()
        new_category = (line.get('new_item_category') or '').strip()
        new_unit = (line.get('new_item_unit') or '').strip()
        if not new_name or not new_category or not new_unit:
            return 'Each line requires either an existing item or a new item name, category, and unit'
        parsed.append({
            'new_item_name': new_name,
            'new_item_category': new_category,
            'new_item_unit': new_unit,
            'requested_quantity': quantity,
        })

    for line in list(req.lines):
        db.session.delete(line)
    db.session.flush()

    for line in parsed:
        db.session.add(MaterialRequestLine(request_id=req.id, **line))

    return None


@requests_api.route('', methods=['GET'])
@login_required
def list_requests():
    status = request.args.get('status')
    query = MaterialRequest.query
    if status:
        query = query.filter_by(status=status)
    reqs = query.order_by(MaterialRequest.created_at.desc()).all()
    return jsonify([r.to_dict() for r in reqs])


@requests_api.route('', methods=['POST'])
@roles_required(ROLE_ADMIN, ROLE_MANAGER, ROLE_STOREKEEPER)
def create_request():
    data = request.get_json(silent=True) or {}

    target_location_id = data.get('target_location_id')
    notes = (data.get('notes') or '').strip()
    lines = data.get('lines') or []

    if not target_location_id:
        return jsonify({'error': 'target_location_id is required'}), 400

    location = Location.query.get(target_location_id)
    if location is None:
        return jsonify({'error': 'Target location does not exist'}), 400

    req = MaterialRequest(
        requester_id=current_user.id,
        target_location_id=target_location_id,
        status=REQUEST_PENDING,
        notes=notes,
    )
    db.session.add(req)
    db.session.flush()

    error = _apply_lines(req, lines)
    if error:
        db.session.rollback()
        return jsonify({'error': error}), 400

    db.session.add(InventoryLog(
        user_id=current_user.id,
        action='REQUEST_CREATED',
        notes=f'Material request #{req.id} created for {location.name}',
    ))
    db.session.commit()
    return jsonify(req.to_dict()), 201


@requests_api.route('/<int:request_id>', methods=['PUT'])
@login_required
def update_request(request_id):
    req = MaterialRequest.query.get_or_404(request_id)

    if current_user.role in (ROLE_ADMIN, ROLE_MANAGER):
        pass
    elif current_user.role == ROLE_STOREKEEPER:
        if req.requester_id != current_user.id:
            return jsonify({'error': 'You can only edit your own requests'}), 403
        if req.status != REQUEST_PENDING:
            return jsonify({'error': 'Only pending requests can be edited'}), 400
    else:
        return jsonify({'error': 'Insufficient permissions for this action'}), 403

    data = request.get_json(silent=True) or {}

    if 'target_location_id' in data and data['target_location_id']:
        location = Location.query.get(data['target_location_id'])
        if location is None:
            return jsonify({'error': 'Target location does not exist'}), 400
        req.target_location_id = data['target_location_id']

    if 'notes' in data:
        req.notes = (data.get('notes') or '').strip()

    if 'lines' in data:
        error = _apply_lines(req, data['lines'])
        if error:
            db.session.rollback()
            return jsonify({'error': error}), 400

    db.session.add(InventoryLog(
        user_id=current_user.id,
        action='REQUEST_UPDATED',
        notes=f'Material request #{req.id} updated',
    ))
    db.session.commit()
    return jsonify(req.to_dict())


@requests_api.route('/<int:request_id>/approve', methods=['POST'])
@roles_required(ROLE_ADMIN, ROLE_MANAGER)
def approve_request(request_id):
    req = MaterialRequest.query.get_or_404(request_id)
    if req.status != REQUEST_PENDING:
        return jsonify({'error': 'Only pending requests can be approved'}), 400

    req.status = REQUEST_APPROVED
    req.reviewed_by_id = current_user.id

    # New-item lines: add the material to the catalog (with zero stock) so it
    # can be checked in once it physically arrives from the supplier.
    for line in req.lines:
        if line.item_id is not None:
            continue

        existing = Item.query.filter(db.func.lower(Item.name) == line.new_item_name.lower()).first()
        if existing is None:
            existing = Item(
                item_code=generate_item_code(),
                name=line.new_item_name,
                category=line.new_item_category,
                unit=line.new_item_unit,
                min_stock_level=0,
            )
            db.session.add(existing)
            db.session.flush()
            db.session.add(InventoryLog(
                user_id=current_user.id,
                action='ITEM_CREATED',
                item_id=existing.id,
                notes=f'Item "{existing.name}" added to catalog via approved request #{req.id}',
            ))
        line.item_id = existing.id

    db.session.add(InventoryLog(
        user_id=current_user.id,
        action='REQUEST_APPROVED',
        notes=f'Material request #{req.id} approved for {req.target_location.name}',
    ))
    db.session.commit()
    return jsonify(req.to_dict())


@requests_api.route('/<int:request_id>/reject', methods=['POST'])
@roles_required(ROLE_ADMIN, ROLE_MANAGER)
def reject_request(request_id):
    req = MaterialRequest.query.get_or_404(request_id)
    if req.status != REQUEST_PENDING:
        return jsonify({'error': 'Only pending requests can be rejected'}), 400

    req.status = REQUEST_REJECTED
    req.reviewed_by_id = current_user.id

    db.session.add(InventoryLog(
        user_id=current_user.id,
        action='REQUEST_REJECTED',
        notes=f'Material request #{req.id} rejected for {req.target_location.name}',
    ))
    db.session.commit()
    return jsonify(req.to_dict())


@requests_api.route('/<int:request_id>/lines/<int:line_id>/receive', methods=['POST'])
@roles_required(ROLE_ADMIN, ROLE_MANAGER, ROLE_STOREKEEPER)
def receive_line(request_id, line_id):
    """Record delivered quantity for one MRF line and check it into stock."""
    req = MaterialRequest.query.get_or_404(request_id)
    line = MaterialRequestLine.query.filter_by(id=line_id, request_id=req.id).first_or_404()

    if req.status != REQUEST_APPROVED:
        return jsonify({'error': 'Only lines on an approved request can be received'}), 400

    data = request.get_json(silent=True) or {}
    received_quantity = _parse_quantity(data.get('received_quantity'))

    if received_quantity is None or received_quantity < 0:
        return jsonify({'error': 'received_quantity must be a non-negative number'}), 400
    if received_quantity < line.received_quantity:
        return jsonify({'error': 'received_quantity cannot be decreased'}), 400
    if received_quantity > line.requested_quantity:
        return jsonify({'error': 'received_quantity cannot exceed requested_quantity'}), 400

    delta = received_quantity - line.received_quantity
    if delta > 0 and line.item_id:
        item = Item.query.get(line.item_id)
        stock = StockLevel.query.filter_by(item_id=item.id, location_id=req.target_location_id).first()
        if stock is None:
            stock = StockLevel(item_id=item.id, location_id=req.target_location_id, quantity=0)
            db.session.add(stock)
        stock.quantity += delta

        db.session.add(InventoryLog(
            user_id=current_user.id,
            action='CHECK_IN',
            item_id=item.id,
            location_id=req.target_location_id,
            quantity=delta,
            notes=f'Received against Material Request #{req.id}',
        ))

    line.received_quantity = received_quantity
    line.refresh_status()

    db.session.commit()
    return jsonify(req.to_dict())


@requests_api.route('/<int:request_id>', methods=['DELETE'])
@roles_required(ROLE_ADMIN)
def delete_request(request_id):
    req = MaterialRequest.query.get_or_404(request_id)
    db.session.delete(req)
    db.session.add(InventoryLog(
        user_id=current_user.id,
        action='REQUEST_DELETED',
        notes=f'Material request #{request_id} deleted',
    ))
    db.session.commit()
    return jsonify({'message': 'Request deleted'})
