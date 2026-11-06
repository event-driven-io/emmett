// How numeric and semver-string versions sort and filter in JS, SQLite, PostgreSQL and MongoDB.
// Needs PostgreSQL on localhost:55432 (password pg) and MongoDB on localhost:27099.
import { DatabaseSync } from 'node:sqlite';
import { MongoClient, type CollationOptions, type Sort } from 'mongodb';
import pg from 'pg';

const numbers = [1, 2, 9, 10];
const semvers = ['1.0.0', '1.2.0', '9.0.0', '10.0.0', '1.10.0'];

console.log('JS, numbers sorted:', [...numbers].sort((a, b) => a - b).join(', '));
console.log('JS, semver strings sorted:', [...semvers].sort().join(', '));

const sqlite = new DatabaseSync(':memory:');
sqlite.exec('CREATE TABLE n (v INTEGER); CREATE TABLE s (v TEXT);');
for (const v of numbers) sqlite.prepare('INSERT INTO n VALUES (?)').run(v);
for (const v of semvers) sqlite.prepare('INSERT INTO s VALUES (?)').run(v);
const column = (rows: unknown[]) => rows.map((row) => (row as { v: unknown }).v).join(', ');
console.log('SQLite, INTEGER ORDER BY:', column(sqlite.prepare('SELECT v FROM n ORDER BY v').all()));
console.log('SQLite, TEXT ORDER BY:', column(sqlite.prepare('SELECT v FROM s ORDER BY v').all()));
console.log("SQLite, TEXT WHERE v < '10.0.0':", column(sqlite.prepare("SELECT v FROM s WHERE v < '10.0.0' ORDER BY v").all()));

const postgres = new pg.Client({ host: 'localhost', port: 55432, user: 'postgres', password: 'pg' });
await postgres.connect();
await postgres.query('CREATE TEMP TABLE s (v TEXT)');
for (const v of semvers) await postgres.query('INSERT INTO s VALUES ($1)', [v]);
const pgColumn = async (sql: string) => (await postgres.query<{ v: string }>(sql)).rows.map((row) => row.v).join(', ');
console.log('PostgreSQL, TEXT ORDER BY (COLLATE "C"):', await pgColumn('SELECT v FROM s ORDER BY v COLLATE "C"'));
console.log("PostgreSQL, ORDER BY string_to_array(v, '.')::int[]:", await pgColumn("SELECT v FROM s ORDER BY string_to_array(v, '.')::int[]"));
console.log(
  "PostgreSQL, WHERE string_to_array(v, '.')::int[] < '{10,0,0}':",
  await pgColumn("SELECT v FROM s WHERE string_to_array(v, '.')::int[] < '{10,0,0}' ORDER BY string_to_array(v, '.')::int[]"),
);
await postgres.end();

const mongo = new MongoClient('mongodb://localhost:27099/version_ordering');
await mongo.connect();
const docs = mongo.db().collection<{ v: string }>('s');
await docs.deleteMany({});
await docs.insertMany(semvers.map((v) => ({ v })));
const mongoColumn = async (sort: Sort, collation?: CollationOptions) =>
  (await docs.find({}, { sort, ...(collation ? { collation } : {}) }).toArray()).map((doc) => doc.v).join(', ');
console.log('MongoDB, string sort:', await mongoColumn({ v: 1 }));
console.log('MongoDB, sort with collation numericOrdering:', await mongoColumn({ v: 1 }, { locale: 'en', numericOrdering: true }));
await mongo.close();
