from flask import Blueprint, request, jsonify
from flask_login import current_user

from extensions import db
from models import Item, Location, StockLevel, InventoryLog, ROLE_ADMIN, ROLE_STOREKEEPER
from routes.decorators import roles_required

transfers_api = Blueprint('transfers_api', __name__)


def _parse_quantity(value):
    try:
        quantity = float(value)
    except (TypeError, ValueError):
        return None
    return quantity


@transfers_api.route('', methods=['POST'])
@roles_required(ROLE_ADMIN, ROLE_STOREKEEPER)
def create_transfer():
    data = request.get_json(silent=True) or {}

    item_id = data.get('item_id')
    from_location_id = data.get('from_location_id')
    to_location_id = data.get('to_location_id')
    quantity = _parse_quantity(data.get('quantity'))
    notes = (data.get('notes') or '').strip()

    if not item_id or not from_location_id or not to_location_id or quantity is None:
        return jsonify({'error': 'item_id, from_location_id, to_location_id and quantity are required'}), 400

    if from_location_id == to_location_id:
        return jsonify({'error': 'Source and destination locations must be different'}), 400

    if quantity <= 0:
        return jsonify({'error': 'Quantity must be greater than zero'}), 400

    item = Item.query.get_or_404(item_id)
    from_location = Location.query.get_or_404(from_location_id)
    to_location = Location.query.get_or_404(to_location_id)

    # Atomic stock move: both updates are committed together, or neither is.
    source_stock = StockLevel.query.filter_by(item_id=item.id, location_id=from_location.id).first()
    if source_stock is None or source_stock.quantity < quantity:
        return jsonify({'error': f'Insufficient stock of "{item.name}" at {from_location.name}'}), 400

    dest_stock = StockLevel.query.filter_by(item_id=item.id, location_id=to_location.id).first()
    if dest_stock is None:
        dest_stock = StockLevel(item_id=item.id, location_id=to_location.id, quantity=0)
        db.session.add(dest_stock)

    source_stock.quantity -= quantity
    dest_stock.quantity += quantity

    log = InventoryLog(
        user_id=current_user.id,
        action='TRANSFER',
        item_id=item.id,
        location_id=from_location.id,
        target_location_id=to_location.id,
        quantity=quantity,
        notes=notes,
        heat_number=(data.get('heat_number') or '').strip() or None,
        batch_number=(data.get('batch_number') or '').strip() or None,
    )
    db.session.add(log)
    db.session.commit()

    locations = Location.query.order_by(Location.id).all()
    return jsonify({'item': item.to_dict(locations), 'log_id': log.id})
