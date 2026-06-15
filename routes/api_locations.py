from flask import Blueprint, request, jsonify
from flask_login import login_required

from extensions import db
from models import Location, StockLevel, MaterialRequest, ROLE_ADMIN
from routes.decorators import roles_required

locations_api = Blueprint('locations_api', __name__)


@locations_api.route('', methods=['GET'])
@login_required
def list_locations():
    locations = Location.query.order_by(Location.id).all()
    result = []
    for loc in locations:
        d = loc.to_dict()
        d['item_count'] = loc.stock_levels.filter(StockLevel.quantity > 0).count()
        d['total_quantity'] = sum(sl.quantity for sl in loc.stock_levels)
        result.append(d)
    return jsonify(result)


@locations_api.route('', methods=['POST'])
@roles_required(ROLE_ADMIN)
def create_location():
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Location name is required'}), 400
    if Location.query.filter_by(name=name).first():
        return jsonify({'error': 'A location with this name already exists'}), 400

    loc = Location(name=name, description=(data.get('description') or '').strip())
    db.session.add(loc)
    db.session.commit()
    return jsonify(loc.to_dict()), 201


@locations_api.route('/<int:location_id>', methods=['PUT'])
@roles_required(ROLE_ADMIN)
def update_location(location_id):
    loc = Location.query.get_or_404(location_id)
    data = request.get_json(silent=True) or {}

    name = (data.get('name') or '').strip()
    if name:
        existing = Location.query.filter_by(name=name).first()
        if existing and existing.id != loc.id:
            return jsonify({'error': 'A location with this name already exists'}), 400
        loc.name = name

    if 'description' in data:
        loc.description = (data.get('description') or '').strip()

    db.session.commit()
    return jsonify(loc.to_dict())


@locations_api.route('/<int:location_id>', methods=['DELETE'])
@roles_required(ROLE_ADMIN)
def delete_location(location_id):
    loc = Location.query.get_or_404(location_id)

    if loc.stock_levels.filter(StockLevel.quantity > 0).count() > 0:
        return jsonify({'error': 'Cannot delete a location that still holds stock'}), 400

    if MaterialRequest.query.filter_by(target_location_id=loc.id).first():
        return jsonify({'error': 'Cannot delete a location referenced by material requests'}), 400

    db.session.delete(loc)
    db.session.commit()
    return jsonify({'message': 'Location deleted'})
