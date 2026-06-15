from flask import Blueprint, render_template, redirect, url_for, abort
from flask_login import login_required

from models import InventoryLog

pages_bp = Blueprint('pages', __name__)


@pages_bp.route('/')
@login_required
def index():
    return redirect(url_for('pages.dashboard'))


@pages_bp.route('/dashboard')
@login_required
def dashboard():
    return render_template('dashboard.html')


@pages_bp.route('/inventory')
@login_required
def inventory():
    return render_template('inventory.html')


@pages_bp.route('/locations')
@login_required
def locations():
    return render_template('locations.html')


@pages_bp.route('/transfers')
@login_required
def transfers():
    return render_template('transfers.html')


@pages_bp.route('/requests')
@login_required
def requests_page():
    return render_template('requests.html')


@pages_bp.route('/logs')
@login_required
def logs():
    return render_template('logs.html')


@pages_bp.route('/users')
@login_required
def users():
    return render_template('users.html')


@pages_bp.route('/assets')
@login_required
def assets():
    return render_template('assets.html')


@pages_bp.route('/logs/<int:log_id>/slip')
@login_required
def material_issue_slip(log_id):
    log = InventoryLog.query.get_or_404(log_id)
    if log.action not in ('CHECK_OUT', 'TRANSFER'):
        abort(404)
    return render_template('slip.html', log=log)
