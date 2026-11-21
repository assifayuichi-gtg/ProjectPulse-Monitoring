const pics = [
  "Robbi", "Bima", "Ifah", "Huda", "Chiro", "Miftahul", "Maytasya",
  "Mekanik", "Machinist", "QC", "Welder", "Painter & Sandblaster",
];

export class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function progressOf(item) {
  if (typeof item.progress === "number") return Math.max(0, Math.min(100, item.progress));
  if (item.status === "Selesai") return 100;
  return item.status === "Sedang dikerjakan" ? 50 : 0;
}

function unique(items, id) {
  const matches = items.filter((item) => item.id === id);
  if (matches.length !== 1) throw new RequestError("Target tidak ditemukan atau ID ambigu.", 404);
  return matches[0];
}

function textValue(value, limit, required = false) {
  if (typeof value !== "string" || value.length > limit || (required && !value.trim())) {
    throw new RequestError("Nilai teks tidak valid.");
  }
  return value.trim();
}

export function describeChange(state, input, now = new Date()) {
  const { kind, id, patch } = input;
  if (!["task", "subtask"].includes(kind) || typeof id !== "string" || !id || id.length > 200 ||
      !patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new RequestError("Jenis pekerjaan, ID, dan perubahan wajib diisi.");
  }
  const isSubtask = kind === "subtask";
  const item = unique(isSubtask ? state.subs : state.tasks, id);
  const parent = isSubtask ? unique(state.tasks, item.taskId) : item;
  const project = unique(state.projects, parent.projectId);
  const changes = {};
  const previousProgress = isSubtask ? progressOf(item) : undefined;
  const fields = isSubtask ? ["name", "pic", "progress", "note"] : ["name", "pic", "description"];
  for (const [field, value] of Object.entries(patch)) {
    if (!fields.includes(field)) {
      throw new RequestError("Kolom tidak didukung. Progres task dihitung dari subtugas.");
    }
    if (field === "progress") {
      if (!Number.isInteger(value) || value < 0 || value > 100) {
        throw new RequestError("Progres harus berupa bilangan bulat 0–100.");
      }
      if (value > previousProgress && (item.dependsOn || []).some((predecessor) => {
        const dependency = state.subs.find((sub) => sub.id === predecessor);
        return !dependency || progressOf(dependency) < 100;
      })) {
        throw new RequestError("Selesaikan predecessor sebelum menaikkan progres.", 409);
      }
      if (value !== previousProgress) changes.progress = { before: previousProgress, after: value };
      continue;
    }
    const key = field === "description" ? "desc" : field;
    const next = textValue(value, field === "name" ? 200 : field === "pic" ? 100 : 2000, field === "name");
    if (field === "pic" && next && next !== item.pic && !pics.includes(next)) {
      throw new RequestError("Pilih PIC dari daftar ProjectPulse.");
    }
    const before = item[key] ?? "";
    if (before !== next) changes[key] = { before, after: next };
  }
  if (!Object.keys(changes).length) throw new RequestError("Tidak ada perubahan untuk disimpan.");
  const updated = { ...item };
  for (const [key, { after }] of Object.entries(changes)) updated[key] = after;
  if (isSubtask) {
    const date = now.toISOString().slice(0, 10);
    updated.lastUpdatedAt = date;
    if (changes.progress) {
      updated.status = updated.progress === 100 ? "Selesai"
        : updated.progress > 0 ? "Sedang dikerjakan" : "Belum dikerjakan";
      changes.status = { before: item.status ?? "", after: updated.status };
      if (updated.progress > 0 && !updated.actualStart) updated.actualStart = date;
      updated.actualEnd = updated.progress === 100 ? (updated.actualEnd || date) : "";
      for (const key of ["actualStart", "actualEnd"]) {
        if ((item[key] || "") !== (updated[key] || "")) {
          changes[key] = { before: item[key] || "", after: updated[key] || "" };
        }
      }
      updated.lastProgressAt = date;
      updated.history = [...(item.history || []), {
        status: updated.status, progress: updated.progress, date, updatedAt: date,
      }];
    }
  }
  return { item, updated, preview: {
    kind, id, project: { name: project.name, code: project.code },
    task: parent.name, name: item.name, changes,
  } };
}

export function searchWork(state, query) {
  const match = textValue(query?.project, 200, true).toLocaleLowerCase("id-ID");
  const projects = state.projects.filter((p) =>
    [p.code, p.name].some((value) => String(value ?? "").toLocaleLowerCase("id-ID") === match));
  if (projects.length !== 1) {
    return { projects: projects.slice(0, 10).map(({ code, name }) => ({ code, name })), items: [] };
  }
  const filter = textValue(query.keyword ?? "", 200).toLocaleLowerCase("id-ID");
  const offset = query.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new RequestError("Offset tidak valid.");
  const tasks = state.tasks.filter((task) => task.projectId === projects[0].id);
  const work = tasks.flatMap((task) => {
    const subs = state.subs.filter((sub) => sub.taskId === task.id);
    return [
      { kind: "task", id: task.id, name: task.name, pic: task.pic,
        progress: subs.length ? Math.round(subs.reduce((sum, sub) => sum + progressOf(sub), 0) / subs.length) : 0 },
      ...subs.map((sub) => ({ kind: "subtask", id: sub.id, name: sub.name, task: task.name,
        taskId: task.id, pic: sub.pic, progress: progressOf(sub) })),
    ];
  }).filter((item) => String(item.name).toLocaleLowerCase("id-ID").includes(filter));
  return {
    project: { code: projects[0].code, name: projects[0].name },
    pics,
    items: work.slice(offset, offset + 20),
    nextOffset: work.length > offset + 20 ? offset + 20 : null,
  };
}
