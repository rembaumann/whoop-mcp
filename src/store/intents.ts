import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Intent, IntentType } from "../types.js";

export interface NewIntent {
  date: string;
  type: IntentType;
  note?: string;
  body_area?: string;
}

interface IntentFile {
  intents: Intent[];
}

export class JsonIntentStore {
  constructor(private readonly filePath: string) {}

  list(): Intent[] {
    return this.read().intents;
  }

  add(input: NewIntent): Intent {
    const file = this.read();
    const intent: Intent = {
      id: crypto.randomUUID(),
      date: input.date,
      type: input.type,
      created_at: new Date().toISOString(),
    };
    if (input.note) intent.note = input.note;
    if (input.body_area) intent.body_area = input.body_area;
    file.intents.push(intent);
    this.write(file);
    return intent;
  }

  private read(): IntentFile {
    if (!fs.existsSync(this.filePath)) return { intents: [] };
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as IntentFile;
    if (!parsed || !Array.isArray(parsed.intents)) return { intents: [] };
    return parsed;
  }

  private write(file: IntentFile): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
    fs.chmodSync(this.filePath, 0o600);
  }
}
