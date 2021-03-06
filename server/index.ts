import sqlite from "better-sqlite3";
import { Application, Router, json } from "express";
import { existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { readFileSync, writeFileSync } from "fs";
import format from "date-fns/format";

import { IndexList } from "../src/@types/sqlite";
import { TableInfo } from "../src/@types/TableInfo";

const STATS_FILE_PATH = "stats.json";
const DB_PATH = resolve(".data");

type Stats = {
  [key: string]: {
    [key: string]: number;
  };
};

const readStats = () => {
  let result = {};
  try {
    result = JSON.parse(readFileSync(STATS_FILE_PATH).toString());
  } catch (err) {
    console.error(err);
  }
  return result;
};

const dumpStats = (stats: Stats) => {
  try {
    writeFileSync(STATS_FILE_PATH, JSON.stringify(stats), { flag: "w+" });
  } catch (err) {
    console.error(err);
  }
};

const apiRouter = Router();

if (!existsSync(DB_PATH)) {
  mkdirSync(DB_PATH);
}

const db = sqlite(join(DB_PATH, "main.db"));

db.prepare(
  "CREATE TABLE IF NOT EXISTS 'certification' ('id' INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, 'date' TEXT NOT NULL, 'type' TEXT NOT NULL, 'loadId' INTEGER, FOREIGN KEY('loadId') REFERENCES 'load'('id') ON DELETE SET NULL ON UPDATE CASCADE);"
).run();
db.prepare(
  "CREATE TABLE IF NOT EXISTS 'faculty' ('id' INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT UNIQUE, 'name' text NOT NULL UNIQUE, 'deanName' text NOT NULL, 'roomPhone' INTEGER NOT NULL);"
).run();
db.prepare(
  "CREATE TABLE IF NOT EXISTS 'group' ('id' INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, 'name' TEXT NOT NULL, 'number' INTEGER NOT NULL, 'year' INTEGER NOT NULL, 'course' INTEGER NOT NULL, 'branch' TEXT NOT NULL);"
).run();
db.prepare(
  "CREATE TABLE IF NOT EXISTS 'load' ('id' INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, 'year' INTEGER NOT NULL, 'groupId' INTEGER, 'subjectId' INTEGER, 'teacherId' INTEGER, FOREIGN KEY('groupId') REFERENCES 'group'('id') ON DELETE SET NULL ON UPDATE CASCADE, FOREIGN KEY('subjectId') REFERENCES 'subject'('id') ON DELETE SET NULL ON UPDATE CASCADE, FOREIGN KEY('teacherId') REFERENCES 'teacher'('id') ON DELETE SET NULL ON UPDATE CASCADE);"
).run();
db.prepare(
  "CREATE TABLE IF NOT EXISTS 'mark' ('id' INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, 'mark' INTEGER, 'studentId' INTEGER NOT NULL, 'certificationId' INTEGER, FOREIGN KEY('certificationId') REFERENCES 'certification'('id') ON DELETE SET NULL ON UPDATE CASCADE, FOREIGN KEY('studentId') REFERENCES 'student'('id') ON DELETE CASCADE ON UPDATE CASCADE);"
).run();
db.prepare(
  "CREATE TABLE IF NOT EXISTS 'student' ('id' INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, 'name' TEXT NOT NULL, 'surname' TEXT NOT NULL, 'birthYear' INTEGER NOT NULL, 'groupId' INTEGER, FOREIGN KEY('groupId') REFERENCES 'group'('id') ON DELETE CASCADE ON UPDATE CASCADE);"
).run();
db.prepare(
  "CREATE TABLE IF NOT EXISTS 'teacher' ('id' INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, 'surname' TEXT NOT NULL, 'name' TEXT NOT NULL, 'patronymic' TEXT NOT NULL, 'category' TEXT NOT NULL, 'facultyId' INTEGER, FOREIGN KEY('facultyId') REFERENCES 'faculty'('id') ON DELETE SET NULL ON UPDATE CASCADE);"
).run();

export default (app: Application): void => {
  app.use((req, res, next) => {
    res.on("finish", () => {
      const now = new Date();
      const date = format(now, "dd.MM.uuuu");
      const time = format(now, "HH");
      const stats = readStats();
      stats[date] = stats[date] || {};
      const stat = stats[date][time];
      stats[date][time] = stat ? stat + 1 : 1;
      dumpStats(stats);
    });
    next();
  });

  app.use(json());

  apiRouter.get("/getUniques/:table", ({ params: { table } }, res) => {
    if (table) {
      const indexList: IndexList[] = db.pragma(`index_list("${table}")`);
      const indexListUnique = indexList.filter((index) => index.unique === 1);
      const uniquesNames: string[] = [];
      for (const { name } of indexListUnique) {
        const { name: uniqueColName } = db.pragma(`index_info(${name})`)[0];
        uniquesNames.push(uniqueColName);
      }
      if (uniquesNames.length) {
        res.status(200).send(uniquesNames);
      } else {
        res.sendStatus(204);
      }
    } else {
      res.sendStatus(400);
    }
  });
  apiRouter.get("/stats", (req, res) => {
    try {
      res.status(200).send(readStats());
    } catch (err) {
      res.sendStatus(500);
      console.error(err);
    }
  });
  apiRouter.get("/list", (req, res) => {
    const tables = db
      .prepare(
        "select name from sqlite_master where type='table' and name <> 'sqlite_sequence';"
      )
      .all();
    if (tables?.length) {
      res.status(200).send(tables);
    } else {
      res.sendStatus(204);
    }
  });
  apiRouter.get("/foreignKeys/:table", ({ params: { table } }, res) => {
    if (table) {
      try {
        const foreignKeys = db.pragma(`foreign_key_list("${table}");`);
        if (foreignKeys?.length) {
          res.status(200).send(foreignKeys);
        } else {
          res.sendStatus(204);
        }
      } catch (err) {
        console.log(err);
        res.sendStatus(500);
      }
    }
  });
  apiRouter.post("/add/:table", ({ params: { table }, query }, res) => {
    if (table) {
      try {
        const info = db
          .prepare(
            `insert into "${table}" (${Object.keys(query).join(
              ","
            )}) values (${Object.values(query)
              .map((v) => `'${v}'`)
              .join(",")});`
          )
          .run();
        res.status(200).send(info);
      } catch (err) {
        console.log(err);
        res.sendStatus(500);
      }
    } else {
      res.sendStatus(400);
    }
  });
  apiRouter.get("/get/:table", ({ params: { table }, query: { id } }, res) => {
    if (table) {
      try {
        const statement = `select * from "${table}"`;
        let tableData = [];
        if (id) {
          tableData = db.prepare(`${statement} where id=${id};`).get();
        } else {
          tableData = db.prepare(`${statement};`).all();
        }
        if (tableData) {
          res.status(200).send(tableData);
        } else {
          res.sendStatus(204);
        }
      } catch (err) {
        console.log(err);
        res.sendStatus(500);
      }
    }
  });
  apiRouter.delete("/delete/:table/:id", ({ params: { table, id } }, res) => {
    if (table && id) {
      try {
        const info = db
          .prepare(`delete from "${table}" where id in (${id});`)
          .run();
        res.status(200).send(info);
      } catch (err) {
        console.log(err);
        res.sendStatus(500);
      }
    } else {
      res.sendStatus(401);
    }
  });
  apiRouter.post(
    "/update/:table/:id",
    ({ params: { table, id }, query }, res) => {
      if (table && id) {
        try {
          const info = db
            .prepare(
              `update "${table}" set ${Object.keys(query)
                .map((key) => `${key}='${query[key]}'`)
                .join(",")} where id=${id}`
            )
            .run();
          res.status(200).send(info);
        } catch (err) {
          console.log(err);
          res.sendStatus(500);
        }
      } else {
        res.sendStatus(401);
      }
    }
  );
  apiRouter.get("/nextId/:table", ({ params: { table } }, res) => {
    if (table) {
      try {
        const nextId = db
          .prepare(
            `select ifnull((select id from "${table}" order by 1 desc limit 1), 0) + 1 "id";`
          )
          .get();
        res.status(200).send(nextId);
      } catch (err) {
        console.log(err);
        res.sendStatus(500);
      }
    }
  });
  apiRouter.get("/info/:table", ({ params: { table } }, res) => {
    if (table) {
      try {
        const pragma: TableInfo[] = db.pragma(`table_info("${table}");`);
        if (pragma?.length) {
          res.status(200).send(pragma);
        } else {
          res.sendStatus(204);
        }
      } catch (err) {
        console.log(err);
        res.sendStatus(500);
      }
    } else {
      res.sendStatus(401);
    }
  });
  app.use("/api", apiRouter);
};
