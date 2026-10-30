import {cpSync} from 'node:fs';
cpSync('apps/api/migrations','apps/api/dist/apps/api/migrations',{recursive:true});
