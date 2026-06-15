import os

from flask import Flask, request, redirect, url_for, jsonify
from sqlalchemy import event
from sqlalchemy.engine import Engine

from config import Config
from extensions import db, login_manager
from models import User

@event.listens_for(Engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    if dbapi_connection.__class__.__module__.startswith("sqlite3"):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

def create_app():
    app = Flask(__name__, instance_relative_config=True)
    app.config.from_object(Config)

    os.makedirs(app.instance_path, exist_ok=True)
    os.makedirs(os.path.join(app.root_path, 'static', 'uploads'), exist_ok=True)

    db.init_app(app)
    login_manager.init_app(app)
    login_manager.login_view = 'auth.login_page'

    @login_manager.user_loader
    def load_user(user_id):
        return User.query.get(int(user_id))

    @login_manager.unauthorized_handler
    def unauthorized():
        if request.path.startswith('/api/'):
            return jsonify({'error': 'Authentication required'}), 401
        return redirect(url_for('auth.login_page'))

    from routes.auth import auth_bp
    from routes.pages import pages_bp
    from routes.api_locations import locations_api
    from routes.api_items import items_api
    from routes.api_transfers import transfers_api
    from routes.api_requests import requests_api
    from routes.api_logs import logs_api
    from routes.api_users import users_api
    from routes.api_dashboard import dashboard_api
    from routes.api_reports import reports_api
    from routes.api_assets import assets_api

    app.register_blueprint(auth_bp)
    app.register_blueprint(pages_bp)
    app.register_blueprint(locations_api, url_prefix='/api/locations')
    app.register_blueprint(items_api, url_prefix='/api/items')
    app.register_blueprint(transfers_api, url_prefix='/api/transfers')
    app.register_blueprint(requests_api, url_prefix='/api/requests')
    app.register_blueprint(logs_api, url_prefix='/api/logs')
    app.register_blueprint(users_api, url_prefix='/api/users')
    app.register_blueprint(dashboard_api, url_prefix='/api/dashboard')
    app.register_blueprint(reports_api, url_prefix='/api/reports')
    app.register_blueprint(assets_api, url_prefix='/api/assets')

    with app.app_context():
        db.create_all()

    return app

app = create_app()

if __name__ == '__main__':
    app.run(debug=True)