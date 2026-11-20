import Database from "better-sqlite3";
import { app } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

let instance: Database.Database | null = null;

function open(): Database.Database {
  if (instance) return instance;
  const dbPath = path.join(app.getPath("userData"), "thunder.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const database = new Database(dbPath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const schemaPath = path.join(here, "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf-8");
  database.exec(sql);
  instance = database;
  return database;
}

export const db: Database.Database = new Proxy({} as Database.Database, {
  get(_target, prop) {
    const real = open();
    const value: unknown = Reflect.get(real, prop, real);
    if (typeof value === "function") {
      return (value as (...args: never[]) => unknown).bind(real);
    }
    return value;
  },
});
