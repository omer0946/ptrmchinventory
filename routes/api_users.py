from flask import Blueprint, request, jsonify
from flask_login import current_user

from extensions import db
from models import (
    User, VALID_ROLES, VALID_USER_STATUSES,
    ROLE_ADMIN, ROLE_MANAGER, USER_STATUS_PENDING,
)
from routes.decorators import roles_required

users_api = Blueprint('users_api', __name__)


@users_api.route('', methods=['GET'])
@roles_required(ROLE_ADMIN, ROLE_MANAGER)
def list_users():
    users = User.query.order_by(User.id).all()
    return jsonify([u.to_dict() for u in users])


@users_api.route('', methods=['POST'])
@roles_required(ROLE_ADMIN, ROLE_MANAGER)
def create_user():
    data = request.get_json(silent=True) or {}

    username = (data.get('username') or '').strip()
    full_name = (data.get('full_name') or '').strip()
    password = data.get('password') or ''
    role = data.get('role') or 'Viewer'

    if not username or not full_name or not password:
        return jsonify({'error': 'Username, full name and password are required'}), 400
    if role not in VALID_ROLES:
        return jsonify({'error': 'Invalid role'}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Username already exists'}), 400

    # New accounts start unapproved and without material handout permission;
    # only Admin/Manager (this endpoint) can approve and grant it afterwards.
    user = User(username=username, full_name=full_name, role=role, status=USER_STATUS_PENDING, material_handout_permission=False)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()
    return jsonify(user.to_dict()), 201


@users_api.route('/<int:user_id>', methods=['PUT'])
@roles_required(ROLE_ADMIN, ROLE_MANAGER)
def update_user(user_id):
    user = User.query.get_or_404(user_id)
    data = request.get_json(silent=True) or {}

    if 'full_name' in data and (data.get('full_name') or '').strip():
        user.full_name = data['full_name'].strip()

    if 'role' in data and data['role'] in VALID_ROLES:
        if user.id == current_user.id and data['role'] != user.role:
            return jsonify({'error': 'You cannot change your own role'}), 400
        user.role = data['role']

    if 'status' in data:
        if data['status'] not in VALID_USER_STATUSES:
            return jsonify({'error': 'Invalid status'}), 400
        user.status = data['status']

    if 'material_handout_permission' in data:
        user.material_handout_permission = bool(data['material_handout_permission'])

    if data.get('password'):
        user.set_password(data['password'])

    db.session.commit()
    return jsonify(user.to_dict())


@users_api.route('/<int:user_id>', methods=['DELETE'])
@roles_required(ROLE_ADMIN)
def delete_user(user_id):
    user = User.query.get_or_404(user_id)
    if user.id == current_user.id:
        return jsonify({'error': 'You cannot delete your own account'}), 400

    db.session.delete(user)
    db.session.commit()
    return jsonify({'message': 'User deleted'})
