import Fastify, { type FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { DomainError } from './db/mutate.js';
export function buildApp(db:Database):FastifyInstance {
 const app=Fastify();
 app.setErrorHandler((error,_request,reply)=>{
  if(error instanceof DomainError) return reply.code(error.statusCode).send({error:error.message,...(error.latest!==undefined?{latest:error.latest}:{})});
  const status=(error as {statusCode?:number}).statusCode;
  return reply.code(status && status>=400 && status<500?status:500).send({error:status && status<500?'Invalid request':'Internal server error'});
 });
 app.get('/health',()=>{db.prepare('SELECT 1').get();return {status:'ok'};});
 return app;
}
