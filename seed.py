from app import app
from extensions import db
from models import (
    User, Location, Item, StockLevel, InventoryLog,
    MaterialRequest, MaterialRequestLine
)
from werkzeug.security import generate_password_hash

def seed_data():
    with app.app_context():
        print("Veritabani tablolari temizleniyor...")
        db.drop_all()
        
        print("Yeni 4'lü RBAC mimarisine gore tablolar olusturuluyor...")
        db.create_all()

        # --- Users -----------------------------------------------------------
        # --- Users -----------------------------------------------------------
        print("Kullanicilar olusturuluyor...")
        admin = User(username='admin', full_name='System Administrator', role='Admin', status='Approved', material_handout_permission=True)
        manager = User(username='manager', full_name='Site Manager', role='Manager', status='Approved', material_handout_permission=False)
        store = User(username='store', full_name='Storekeeper', role='Storekeeper', status='Approved', material_handout_permission=True)
        viewer = User(username='viewer', full_name='Site Staff', role='Viewer', status='Approved', material_handout_permission=False)

        users = [admin, manager, store, viewer]

        for u in users:
            if hasattr(u, 'set_password'):
                u.set_password('123456')
            else:
                u.password_hash = generate_password_hash('123456')

        db.session.add_all(users)
        db.session.flush()

        # --- Locations ---------------------------------------------------------
        print("Lokasyonlar ekleniyor...")
        central = Location(name='Central Warehouse', description='Main storage and distribution facility')
        depot = Location(name='Site Depot', description='On-site material depot')
        zone_x = Location(name='Zone X', description='Active construction zone storage')

        db.session.add_all([central, depot, zone_x])
        db.session.flush()

        # --- Items + initial stock breakdown -----------------------------------
        print("Malzemeler ve stok verileri yukleniyor...")
        items_data = [
            {
                'item_code': 'PIP-001', 'name': 'Carbon Steel Pipe 6" SCH40', 'category': 'Pipe', 'unit': 'Meter',
                'min_stock_level': 100,
                'stock': {central.id: 320, depot.id: 80, zone_x.id: 40},
                'location_min': {central.id: 100, depot.id: 50, zone_x.id: 50},
            },
            {
                'item_code': 'PIP-002', 'name': 'Stainless Steel Pipe 4" SCH80', 'category': 'Pipe', 'unit': 'Meter',
                'min_stock_level': 50,
                'stock': {central.id: 60, depot.id: 10, zone_x.id: 0},
                'location_min': {central.id: 30, depot.id: 20, zone_x.id: 0},
            },
            {
                'item_code': 'FLG-001', 'name': 'Weld Neck Flange 6" 150#', 'category': 'Flange', 'unit': 'Pcs',
                'min_stock_level': 20,
                'stock': {central.id: 45, depot.id: 8, zone_x.id: 2},
                'location_min': {central.id: 20, depot.id: 8, zone_x.id: 5},
            },
            {
                'item_code': 'FLG-002', 'name': 'Blind Flange 4" 300#', 'category': 'Flange', 'unit': 'Pcs',
                'min_stock_level': 10,
                'stock': {central.id: 12, depot.id: 0, zone_x.id: 0},
                'location_min': {central.id: 10, depot.id: 0, zone_x.id: 2},
            },
            {
                'item_code': 'VLV-001', 'name': 'Gate Valve 4" 300#', 'category': 'Valve', 'unit': 'Pcs',
                'min_stock_level': 5,
                'stock': {central.id: 8, depot.id: 2, zone_x.id: 0},
                'location_min': {central.id: 5, depot.id: 2, zone_x.id: 2},
            },
            {
                'item_code': 'VLV-002', 'name': 'Ball Valve 2" 150#', 'category': 'Valve', 'unit': 'Pcs',
                'min_stock_level': 10,
                'stock': {central.id: 15, depot.id: 4, zone_x.id: 1},
                'location_min': {central.id: 8, depot.id: 4, zone_x.id: 2},
            },
            {
                'item_code': 'BLT-001', 'name': 'Hex Bolt M16x60 (Gr 8.8)', 'category': 'Bolt', 'unit': 'Pcs',
                'min_stock_level': 500,
                'stock': {central.id: 1200, depot.id: 300, zone_x.id: 150},
                'location_min': {central.id: 500, depot.id: 300, zone_x.id: 200},
            },
            {
                'item_code': 'BLT-002', 'name': 'Stud Bolt 5/8" UNC w/ Nuts', 'category': 'Bolt', 'unit': 'Set',
                'min_stock_level': 200,
                'stock': {central.id: 180, depot.id: 50, zone_x.id: 20},
                'location_min': {central.id: 100, depot.id: 50, zone_x.id: 30},
            },
            {
                'item_code': 'GSK-001', 'name': 'Gasket Spiral Wound 4"', 'category': 'Gasket', 'unit': 'Pcs',
                'min_stock_level': 30,
                'stock': {central.id: 40, depot.id: 5, zone_x.id: 0},
                'location_min': {central.id: 30, depot.id: 5, zone_x.id: 5},
            },
            {
                'item_code': 'STL-001', 'name': 'Structural Steel Beam I-200', 'category': 'Structural Steel', 'unit': 'Ton',
                'min_stock_level': 5,
                'stock': {central.id: 12, depot.id: 1, zone_x.id: 0.5},
                'location_min': {central.id: 5, depot.id: 1, zone_x.id: 1},
            },
            {
                'item_code': 'CSM-001', 'name': 'Welding Electrode E7018', 'category': 'Consumable', 'unit': 'Pcs',
                'min_stock_level': 1000,
                'stock': {central.id: 5000, depot.id: 800, zone_x.id: 200},
                'location_min': {central.id: 1000, depot.id: 800, zone_x.id: 300},
            },
            {
                'item_code': 'FIT-001', 'name': 'Elbow 90deg 6" SCH40', 'category': 'Fitting', 'unit': 'Pcs',
                'min_stock_level': 15,
                'stock': {central.id: 22, depot.id: 4, zone_x.id: 0},
                'location_min': {central.id: 22, depot.id: 4, zone_x.id: 3},
            },
        ]

        for data in items_data:
            item = Item(
                item_code=data['item_code'],
                name=data['name'],
                category=data['category'],
                unit=data['unit'],
                item_type='Consumable',  # Eklendi: Yeni yapi icin zorunlu tip
                min_stock_level=data['min_stock_level'],
            )
            db.session.add(item)
            db.session.flush()

            for loc_id, qty in data['stock'].items():
                db.session.add(StockLevel(
                    item_id=item.id,
                    location_id=loc_id,
                    quantity=qty,
                    min_stock_level=data['location_min'].get(loc_id, 0),
                ))

            db.session.add(InventoryLog(
                user_id=admin.id,
                action='CHECK_IN',
                item_id=item.id,
                quantity=sum(data['stock'].values()),
                notes=f'Initial stock loaded for "{item.name}"',
            ))

        db.session.flush()

        # --- Sample material requests -------------------------------------------
        print("Ornek Talep Formlari (MRF) olusturuluyor...")
        pipe_item = Item.query.filter_by(name='Carbon Steel Pipe 6" SCH40').first()
        valve_item = Item.query.filter_by(name='Gate Valve 4" 300#').first()
        bolt_item = Item.query.filter_by(name='Hex Bolt M16x60 (Gr 8.8)').first()

        pending_request = MaterialRequest(
            requester_id=manager.id,
            target_location_id=zone_x.id,
            status='Pending',
            notes='Needed for pipeline tie-in works at Zone X',
        )
        db.session.add(pending_request)
        db.session.flush()
        
        db.session.add(MaterialRequestLine(request_id=pending_request.id, item_id=pipe_item.id, requested_quantity=50))
        db.session.add(MaterialRequestLine(request_id=pending_request.id, item_id=bolt_item.id, requested_quantity=100))
        
        db.session.add(InventoryLog(
            user_id=manager.id,
            action='REQUEST_CREATED',
            notes=f'Material request #{pending_request.id} created for {zone_x.name}',
        ))

        approved_request = MaterialRequest(
            requester_id=store.id,
            target_location_id=depot.id,
            status='Approved',
            notes='Valve replacement for scheduled maintenance',
            reviewed_by_id=admin.id,
        )
        db.session.add(approved_request)
        db.session.flush()
        
        db.session.add(MaterialRequestLine(request_id=approved_request.id, item_id=valve_item.id, requested_quantity=2))
        
        db.session.add(InventoryLog(
            user_id=store.id,
            action='REQUEST_CREATED',
            notes=f'Material request #{approved_request.id} created for {depot.name}',
        ))
        db.session.add(InventoryLog(
            user_id=admin.id,
            action='REQUEST_APPROVED',
            notes=f'Material request #{approved_request.id} approved for {depot.name}',
        ))

        new_item_request = MaterialRequest(
            requester_id=manager.id,
            target_location_id=central.id,
            status='Pending',
            notes='New insulation material needed for upcoming pipe wrapping works',
        )
        db.session.add(new_item_request)
        db.session.flush()
        
        db.session.add(MaterialRequestLine(
            request_id=new_item_request.id,
            new_item_name='Pipe Insulation Wrap 4"',
            new_item_category='Insulation',
            new_item_unit='Roll',
            requested_quantity=30,
        ))
        
        db.session.add(InventoryLog(
            user_id=manager.id,
            action='REQUEST_CREATED',
            notes=f'Material request #{new_item_request.id} created for {central.name}',
        ))

        db.session.commit()
        
        print("-" * 40)
        print("KURULUM BASARILI!")
        print("Giris yapabileceginiz test hesaplari (Sifreleri: 123456)")
        print("1. admin   (Tam Yetki)")
        print("2. manager (Onay Yetkisi, Zimmet/Malzeme Cikisi Yok)")
        print("3. store   (Ambarci - Malzeme Giris/Cikis ve Zimmet Yetkisi)")
        print("4. viewer  (Sadece Izleme)")
        print("-" * 40)

if __name__ == '__main__':
    seed_data()