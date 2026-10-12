import { buildApp } from './app.js';
import {config} from './config.js';
import {openDb} from './db/open.js';
import {migrate} from './db/migrate.js';
const settings=config();const db=openDb(settings.databasePath);migrate(db);const app=buildApp(db);
app.addHook('onClose',()=>{db.close();});
for(const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,()=>{void app.close();});
try {await app.listen({host:settings.host,port:settings.port});} catch(error){await app.close();throw error;}
