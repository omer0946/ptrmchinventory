from flask import Blueprint, jsonify
from flask_login import login_required

from extensions import db
from models import Item, Location, MaterialRequest, InventoryLog, REQUEST_PENDING, LOSS_REASONS

dashboard_api = Blueprint('dashboard_api', __name__)


@dashboard_api.route('/summary', methods=['GET'])
@login_required
def summary():
    locations = Location.query.order_by(Location.id).all()
    items = Item.query.all()

    pending_requests = MaterialRequest.query.filter_by(status=REQUEST_PENDING).count()

    low_stock_items = []
    for item in items:
        total = item.total_quantity
        if item.min_stock_level > 0 and total < item.min_stock_level:
            low_stock_items.append({
                'id': item.id,
                'name': item.name,
                'category': item.category,
                'unit': item.unit,
                'total_quantity': total,
                'min_stock_level': item.min_stock_level,
            })

    location_totals = []
    for loc in locations:
        total = sum(sl.quantity for sl in loc.stock_levels)
        location_totals.append({'id': loc.id, 'name': loc.name, 'total_quantity': total})

    recent_logs = InventoryLog.query.order_by(InventoryLog.timestamp.desc()).limit(10).all()

    wastage_rows = (
        db.session.query(InventoryLog.reason, db.func.sum(InventoryLog.quantity))
        .filter(InventoryLog.action.in_(['CHECK_OUT', 'ASSET_RETURNED']), InventoryLog.reason.in_(LOSS_REASONS))
        .group_by(InventoryLog.reason)
        .all()
    )
    wastage_totals = {reason: float(total or 0) for reason, total in wastage_rows}
    wastage_by_reason = [
        {'reason': reason, 'quantity': wastage_totals.get(reason, 0)} for reason in LOSS_REASONS
    ]

    return jsonify({
        'total_items': len(items),
        'total_locations': len(locations),
        'pending_requests': pending_requests,
        'low_stock_count': len(low_stock_items),
        'low_stock_items': low_stock_items,
        'location_totals': location_totals,
        'recent_logs': [log.to_dict() for log in recent_logs],
        'wastage_by_reason': wastage_by_reason,
    })
