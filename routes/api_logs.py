from flask import Blueprint, request, jsonify

from models import InventoryLog, ROLE_ADMIN, ROLE_MANAGER, ROLE_STOREKEEPER
from routes.decorators import roles_required

logs_api = Blueprint('logs_api', __name__)


@logs_api.route('', methods=['GET'])
@roles_required(ROLE_ADMIN, ROLE_MANAGER, ROLE_STOREKEEPER)
def list_logs():
    action = request.args.get('action')
    reason = request.args.get('reason')
    query = InventoryLog.query
    if action:
        query = query.filter_by(action=action)
    if reason:
        query = query.filter_by(reason=reason)
    logs = query.order_by(InventoryLog.timestamp.desc()).limit(500).all()
    return jsonify([log.to_dict() for log in logs])
