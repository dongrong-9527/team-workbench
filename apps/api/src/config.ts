export function config(env:NodeJS.ProcessEnv=process.env) {
 const port=Number(env.PORT??3000);if(!Number.isInteger(port)||port<1||port>65535) throw new Error('Invalid PORT');
 return {host:env.HOST??'127.0.0.1',port,databasePath:env.DATABASE_PATH??'workbench.db'};
}
