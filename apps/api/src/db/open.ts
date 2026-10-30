import Database from 'better-sqlite3';
export function openDb(path:string):Database.Database {
 const db=new Database(path);
 try {
  const version=(db.prepare('SELECT sqlite_version() version').get() as {version:string}).version.split('.').map(Number);
  if(version[0]<3 || version[0]===3 && (version[1]<51 || version[1]===51 && version[2]<3)) throw new Error('SQLite >=3.51.3 required');
  db.pragma('foreign_keys = ON'); db.pragma('journal_mode = WAL'); db.pragma('synchronous = FULL'); db.pragma('busy_timeout = 3000');
  return db;
 } catch(error) {db.close();throw error;}
}
