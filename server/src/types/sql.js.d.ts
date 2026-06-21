declare module 'sql.js' {
  interface SqlJsDatabase {
    run(sql: string, params?: any[]): void;
    exec(sql: string): any[];
    prepare(sql: string): any;
    export(): Uint8Array;
  }
  
  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => SqlJsDatabase;
  }
  
  function initSqlJs(): Promise<SqlJsStatic>;
  export default initSqlJs;
  export { SqlJsDatabase, SqlJsStatic };
  export { SqlJsDatabase as Database };
}
