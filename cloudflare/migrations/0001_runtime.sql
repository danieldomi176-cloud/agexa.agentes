-- Apply ONLY after importing/verifying the existing sales.sqlite schema and data.
CREATE TABLE cf_control(id TEXT PRIMARY KEY,paused INTEGER NOT NULL DEFAULT 1,epoch INTEGER NOT NULL DEFAULT 0);
INSERT INTO cf_control VALUES('main',1,0);
CREATE TABLE cf_lease(id TEXT PRIMARY KEY,token TEXT,expires INTEGER NOT NULL DEFAULT 0);
INSERT INTO cf_lease(id) VALUES('scheduler');
CREATE TABLE cf_budget(day TEXT PRIMARY KEY,attempts INTEGER NOT NULL DEFAULT 0);
CREATE TABLE cf_jobs(taskId TEXT PRIMARY KEY REFERENCES tasks(id),nextId TEXT,companyId TEXT REFERENCES crm_companies(id),readyAt INTEGER NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('research','provided')),epoch INTEGER,token TEXT);
CREATE TABLE cf_requests(id TEXT PRIMARY KEY,at INTEGER NOT NULL);
