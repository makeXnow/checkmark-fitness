"""Verify a local backup against the exact SQL migration, without changing live data."""
import hashlib,json,sqlite3,sys,pathlib
source=pathlib.Path(sys.argv[1])
backup=json.loads(source.read_text())
rows=backup[0]['results']
metadata=backup[1]['results']
db=sqlite3.connect(':memory:')
db.executescript('CREATE TABLE macro_bundle(device_id TEXT PRIMARY KEY,goals_json TEXT,custom_foods_json TEXT,logs_json TEXT,updated_at INTEGER,write_token TEXT);CREATE TABLE macro_log_days(device_id TEXT,date_key TEXT,items_json TEXT,updated_at INTEGER,PRIMARY KEY(device_id,date_key));')
for r in rows:db.execute('INSERT INTO macro_log_days VALUES(?,?,?,?)',(r['device_id'],r['date_key'],r['items_json'],r['updated_at']))
db.commit()
before={(r['device_id'],r['date_key']):json.loads(r['items_json']) for r in rows}
db.executescript('BEGIN;'+pathlib.Path('migrations/0010_macro_entries.sql').read_text()+'COMMIT;')
after={k:[] for k in before}
for profile,day,payload in db.execute('SELECT device_id,date_key,payload_json FROM macro_entries WHERE deleted_at IS NULL ORDER BY device_id,date_key,ordinal,entry_id'):
    after[(profile,day)].append(json.loads(payload))
assert before==after,'Migration changed diary entries'
archive={(p,d):json.loads(v) for p,d,v in db.execute('SELECT device_id,date_key,items_json FROM macro_log_days_archive_0010')}
assert archive==before,'Recovery archive differs'
# Prove an old app write during rollout is mirrored safely, without altering its archive.
profile,day=next(iter(before))
old=before[(profile,day)]
probe={'id':'migration-compatibility-probe','name':'Synthetic migration test','calories':0}
db.execute('UPDATE macro_log_days SET items_json=?,updated_at=updated_at+1 WHERE device_id=? AND date_key=?',(json.dumps(old+[probe]),profile,day))
assert db.execute('SELECT COUNT(*) FROM macro_entries WHERE device_id=? AND date_key=? AND entry_id=? AND deleted_at IS NULL',(profile,day,probe['id'])).fetchone()[0]==1
db.execute('UPDATE macro_log_days SET items_json=?,updated_at=updated_at+1 WHERE device_id=? AND date_key=?',(json.dumps(old),profile,day))
assert db.execute('SELECT deleted_at FROM macro_entries WHERE entry_id=?',(probe['id'],)).fetchone()[0] is not None
report={'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'days':len(before),'entries':sum(map(len,before.values())),'allFieldsAndOrderPreserved':True,'archiveVerified':True,'oldAppCompatibilityVerified':True}
print(json.dumps(report,indent=2))
