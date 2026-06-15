from functools import wraps

from flask import jsonify
from flask_login import current_user


def roles_required(*roles):
    """Restrict an API endpoint to the given user roles."""

    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            if not current_user.is_authenticated:
                return jsonify({'error': 'Authentication required'}), 401
            if current_user.role not in roles:
                return jsonify({'error': 'Insufficient permissions for this action'}), 403
            return f(*args, **kwargs)
        return wrapper
    return decorator
