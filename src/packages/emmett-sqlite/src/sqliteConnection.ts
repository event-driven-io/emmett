import type sqlite3 from 'sqlite3';


export type SQLiteConnection = {
  command: (sql: string, values?: any[]) => Promise<void>;
  // query: <T>(sql: string, values?: any[]) => Promise<T[]>;
  querySingle: <T>(sql: string, values?: any[]) => Promise<T>;
}


export const dbConn = (conn: sqlite3.Database): SQLiteConnection => {
  let db = conn;

  return {
    command: (sql: string, values?: any[]) => new Promise((resolve, reject) => {
      !values && (values = []);

      db.run(sql, values, (err: any, result: any) => {
        if (err) {
          return reject(err);
        }

        return resolve(result);
      });
    }),
    // query: (sql: string, values?: any[]) => new Promise((resolve, reject) => {
    //   !values && (values = []);

    //   db.all(sql, values, (err: any, result: any) => {
    //     if (err) {
    //       return reject(err);
    //     }
    //     return resolve(result);
    //   });
    // }),
    querySingle: (sql: string, values?: any[]) => new Promise((resolve, reject) => {
      db.get(sql, values, (err: any, result: any) => {
        if (err) {
          return reject(err);
        }
        return resolve(result);
      });
    }),
  }
}
