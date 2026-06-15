from datetime import datetime

from flask import Blueprint, request, jsonify
from flask_login import current_user

from extensions import db
from models import (
    Item, Location, User, StockLevel, InventoryLog, AssetAssignment,
    ITEM_TYPE_FIXED_ASSET, USER_STATUS_APPROVED,
    VALID_RETURN_CONDITIONS, RETURN_RETURNED,
    ROLE_ADMIN, ROLE_MANAGER, ROLE_STOREKEEPER,
)
from routes.decorators import roles_required

assets_api = Blueprint('assets_api', __name__)


def _parse_quantity(value):
    try:
        quantity = float(value)
    except (TypeError, ValueError):
        return None
    return quantity


@assets_api.route('/eligible-users', methods=['GET'])
@roles_required(ROLE_ADMIN, ROLE_MANAGER, ROLE_STOREKEEPER)
def eligible_users():
    """Users approved and permitted to receive material handouts (Zimmet)."""
    users = User.query.filter_by(
        status=USER_STATUS_APPROVED, material_handout_permission=True
    ).order_by(User.full_name).all()
    return jsonify([u.to_dict() for u in users])


@assets_api.route('/assign', methods=['POST'])
@roles_required(ROLE_ADMIN, ROLE_STOREKEEPER)
def assign_asset():
    data = request.get_json(silent=True) or {}

    item_id = data.get('item_id')
    location_id = data.get('location_id')
    assigned_to_id = data.get('assigned_to_id')
    quantity = _parse_quantity(data.get('quantity'))
    notes = (data.get('notes') or '').strip()

    if not item_id or not location_id or not assigned_to_id or quantity is None:
        return jsonify({'error': 'item_id, location_id, assigned_to_id and quantity are required'}), 400
    if quantity <= 0:
        return jsonify({'error': 'Quantity must be greater than zero'}), 400

    item = Item.query.get_or_404(item_id)
    location = Location.query.get_or_404(location_id)
    assigned_to = User.query.get_or_404(assigned_to_id)

    if item.item_type != ITEM_TYPE_FIXED_ASSET:
        return jsonify({'error': 'Only Fixed Asset items can be assigned (Zimmet)'}), 400

    if not assigned_to.can_receive_handout:
        return jsonify({'error': f'"{assigned_to.full_name}" is not an Approved user with material handout permission'}), 400

    stock = StockLevel.query.filter_by(item_id=item.id, location_id=location.id).first()
    if stock is None or stock.quantity < quantity:
        return jsonify({'error': f'Insufficient stock of "{item.name}" at {location.name}'}), 400

    stock.quantity -= quantity

    log = InventoryLog(
        user_id=current_user.id,
        action='ASSET_ASSIGNED',
        item_id=item.id,
        location_id=location.id,
        quantity=quantity,
        notes=notes or f'Assigned to {assigned_to.full_name}',
    )
    db.session.add(log)
    db.session.flush()

    assignment = AssetAssignment(
        item_id=item.id,
        location_id=location.id,
        quantity=quantity,
        assigned_to_id=assigned_to.id,
        assigned_by_id=current_user.id,
        notes=notes,
        checkout_log_id=log.id,
    )
    db.session.add(assignment)
    db.session.commit()

    return jsonify({'assignment': assignment.to_dict(), 'log_id': log.id}), 201


@assets_api.route('/<int:assignment_id>/return', methods=['POST'])
@roles_required(ROLE_ADMIN, ROLE_STOREKEEPER)
def return_asset(assignment_id):
    assignment = AssetAssignment.query.get_or_404(assignment_id)
    if assignment.is_returned:
        return jsonify({'error': 'This asset has already been returned'}), 400

    data = request.get_json(silent=True) or {}
    condition = (data.get('condition') or RETURN_RETURNED).strip()
    notes = (data.get('notes') or '').strip()

    if condition not in VALID_RETURN_CONDITIONS:
        return jsonify({'error': f'condition must be one of: {", ".join(VALID_RETURN_CONDITIONS)}'}), 400

    item = assignment.item

    if condition == RETURN_RETURNED:
        stock = StockLevel.query.filter_by(item_id=item.id, location_id=assignment.location_id).first()
        if stock is None:
            stock = StockLevel(item_id=item.id, location_id=assignment.location_id, quantity=0)
            db.session.add(stock)
        stock.quantity += assignment.quantity
        log_reason = None
        log_notes = notes or f'Returned by {assignment.assigned_to.full_name}'
    else:
        # Damaged / Lost returns are not restocked; they feed the wastage report.
        log_reason = condition
        log_notes = notes or f'Reported {condition.lower()} by {assignment.assigned_to.full_name}'

    log = InventoryLog(
        user_id=current_user.id,
        action='ASSET_RETURNED',
        item_id=item.id,
        location_id=assignment.location_id,
        quantity=assignment.quantity,
        notes=log_notes,
        reason=log_reason,
    )
    db.session.add(log)
    db.session.flush()

    assignment.returned_at = datetime.utcnow()
    assignment.return_condition = condition
    assignment.return_notes = notes
    assignment.return_log_id = log.id

    db.session.commit()
    return jsonify(assignment.to_dict())


@assets_api.route('/registry', methods=['GET'])
@roles_required(ROLE_ADMIN, ROLE_MANAGER, ROLE_STOREKEEPER)
def asset_registry():
    """Personnel Asset Registry: approved/handout-eligible users + their active loan counts."""
    users = User.query.filter_by(
        status=USER_STATUS_APPROVED, material_handout_permission=True
    ).order_by(User.full_name).all()

    result = []
    for user in users:
        active_count = AssetAssignment.query.filter_by(
            assigned_to_id=user.id, returned_at=None
        ).count()
        d = user.to_dict()
        d['active_assignments'] = active_count
        result.append(d)

    return jsonify(result)


@assets_api.route('/registry/<int:user_id>', methods=['GET'])
@roles_required(ROLE_ADMIN, ROLE_MANAGER, ROLE_STOREKEEPER)
def user_asset_history(user_id):
    user = User.query.get_or_404(user_id)
    assignments = AssetAssignment.query.filter_by(assigned_to_id=user.id).order_by(AssetAssignment.assigned_at.desc()).all()

    return jsonify({
        'user': user.to_dict(),
        'active': [a.to_dict() for a in assignments if not a.is_returned],
        'history': [a.to_dict() for a in assignments if a.is_returned],
    })
